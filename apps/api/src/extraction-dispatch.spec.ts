import type { FileStore } from '@aiontheballot/db/file-store';

import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { describe, expect, it, vi } from 'vitest';

import type { WaitingExtraction } from './admin/sources.js';

import {
  backoff,
  createExtractionDispatch,
  MAX_IN_FLIGHT,
  MAX_LOST,
  REDELIVER_AFTER_MS,
  RETRY,
  STALE_AFTER_MS,
  STALE_REPORT_EVERY_MS,
} from './extraction-dispatch.js';

const JOB = {
  jobId: '0190f8c4-0000-7000-8000-000000000a01',
  tenantId: '0190f8c4-0000-7000-8000-00000000000a',
  sha256: 'a'.repeat(64),
  contentType: 'application/pdf',
};
const TOKEN = 'un-secreto-compartido-de-prueba-de-mas-de-32';
const files = (bytes: Uint8Array | undefined) =>
  ({
    open: async () =>
      bytes
        ? { byteSize: bytes.byteLength, stream: Readable.from([Buffer.from(bytes)]) }
        : undefined,
  }) as unknown as FileStore;

type Fetch = typeof fetch;

/** A dispatch with the test's fetch, waits that only record themselves, and whatever else a test sets. */
const dispatchWith = (
  fetch: Fetch,
  options: Partial<Parameters<typeof createExtractionDispatch>[0]> = {},
) => {
  const waits: number[] = [];
  const errors: { message: string; transient: boolean }[] = [];
  const stale: WaitingExtraction[][] = [];
  const dispatch = createExtractionDispatch({
    workerUrl: 'http://worker.example.test:3002',
    token: TOKEN,
    files: files(new Uint8Array([1, 2, 3])),
    onError: (error, transient) => errors.push({ message: error.message, transient }),
    onStale: (job) => stale.push(job),
    fetch,
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.5,
    ...options,
  });
  return { dispatch, waits, errors, stale };
};

/** Answers each try in turn: a status, or a thrown error as fetch throws for no answer. */
const answers = (...each: (number | Error)[]) => {
  const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
    await text(init?.body as ReadableStream);
    const next = each[Math.min(fetch.mock.calls.length - 1, each.length - 1)];
    if (next instanceof Error) {
      throw next;
    }
    return new Response(null, { status: next });
  });
  return fetch;
};

/** fetch's error when nothing could connect, or when the connection went after the request was sent. */
const failedFetch = (code: string) =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(code), { code }),
  });
const unreachable = () => failedFetch('ECONNREFUSED');
const wentAway = () => failedFetch('UND_ERR_SOCKET');

describe('the extraction dispatch (ADR-0006)', () => {
  it("posts the job's copy to the worker, by the job's id, with the shared secret", async () => {
    const bodies: string[] = [];
    // Read as the worker would, while the copy is still open.
    const fetch = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(await text(init?.body as ReadableStream));
      return new Response(null, { status: 204 });
    });
    const { dispatch } = dispatchWith(fetch);
    await dispatch.sent(JOB);
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(`http://worker.example.test:3002/jobs/${JOB.jobId}`);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('content-length')).toBe('3');
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(bodies).toEqual([Buffer.from([1, 2, 3]).toString()]);
  });

  it('sends a job once while it is on its way', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetch = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          void text(init?.body as ReadableStream);
          answer = resolve;
        }),
    );
    const { dispatch } = dispatchWith(fetch);
    dispatch.dispatch(JOB);
    dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    answer(new Response(null, { status: 204 }));
    await vi.waitFor(async () => {
      dispatch.dispatch(JOB);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('takes a finished job, or one the worker has, for done', async () => {
    for (const status of [204, 404, 409]) {
      const { dispatch, errors } = dispatchWith(answers(status));
      await expect(dispatch.sent(JOB)).resolves.toBeUndefined();
      expect(errors).toEqual([]);
    }
  });

  it('tries again while the worker is away or busy, with growing jittered waits, until it takes the job', async () => {
    const fetch = answers(unreachable(), 503, 502, 429, 504, 204);
    const { dispatch, waits, errors } = dispatchWith(fetch);
    dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(6));
    await vi.waitFor(() => expect(waits).toHaveLength(5));
    // Half of each step fixed, half drawn (0.5 here): 2 s doubled each time, up to 30 s.
    expect(waits).toEqual([1_500, 3_000, 6_000, 12_000, 22_500]);
    expect(errors).toEqual([]);
  });

  it('gives up after its last try, the job left open for redelivery, and says the failure may pass', async () => {
    const fetch = answers(503);
    const { dispatch, errors, waits } = dispatchWith(fetch, {
      retry: { attempts: 3, baseMs: 10, capMs: 1_000 },
    });
    dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(waits).toHaveLength(2);
    expect(errors[0]).toEqual({
      message: `Extraction job ${JOB.jobId}: the worker answered 503`,
      transient: true,
    });
  });

  it('reports at once, without trying again, what another try would only repeat', async () => {
    // 401: a secret that isn't the worker's. 422: bytes that aren't the source's copy. 500: the worker's own fault.
    for (const status of [400, 401, 413, 415, 422, 500]) {
      const fetch = answers(status);
      const { dispatch, errors, waits } = dispatchWith(fetch);
      dispatch.dispatch(JOB);
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(waits).toEqual([]);
      expect(errors[0]).toEqual({
        message: `Extraction job ${JOB.jobId}: the worker answered ${status}`,
        transient: false,
      });
    }
    // The worker held the job for its whole window.
    const timedOut = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    const slow = dispatchWith(answers(timedOut));
    slow.dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(slow.errors).toHaveLength(1));
    expect(slow.waits).toEqual([]);
    expect(slow.errors[0]?.transient).toBe(false);
    // A copy missing from the store.
    const missing = dispatchWith(answers(204), { files: files(undefined) });
    missing.dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(missing.errors).toHaveLength(1));
    expect(missing.errors[0]?.message).toMatch(/not in the file store/);
    expect(missing.errors[0]?.transient).toBe(false);
    // A copy the store finds damaged as it streams it: the request fails on our side, not the worker's.
    const damaged = {
      open: async () => {
        const stream = new Readable({
          read() {
            this.destroy(new Error('The copy does not match its hash'));
          },
        });
        return { byteSize: 3, stream };
      },
    } as unknown as FileStore;
    const broken = dispatchWith(
      async (_url, init) => {
        await text(init?.body as ReadableStream);
        return new Response(null, { status: 204 });
      },
      { files: damaged },
    );
    broken.dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(broken.errors).toHaveLength(1));
    expect(broken.errors[0]).toEqual({
      message: `Extraction job ${JOB.jobId}: its copy could not be read`,
      transient: false,
    });
    expect(broken.waits).toEqual([]);
  });

  it('never tries again at once a job the worker went away with: it may have died on the document', async () => {
    const fetch = answers(wentAway(), 204);
    const { dispatch, errors, waits } = dispatchWith(fetch);
    dispatch.dispatch(JOB);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    // Handed over again later, when its sources are listed.
    expect(errors[0]).toEqual({
      message: `Extraction job ${JOB.jobId}: the worker went away while it had the job (UND_ERR_SOCKET)`,
      transient: true,
    });
  });

  it('hands at most a few jobs over at once, the rest waiting their turn here', async () => {
    const answersFor: ((response: Response) => void)[] = [];
    const fetch = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          void text(init?.body as ReadableStream);
          answersFor.push(resolve);
        }),
    );
    const { dispatch } = dispatchWith(fetch);
    const jobs = Array.from({ length: MAX_IN_FLIGHT + 3 }, (_, i) => ({
      ...JOB,
      jobId: `0190f8c4-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
    }));
    for (const job of jobs) {
      dispatch.dispatch(job);
    }
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(MAX_IN_FLIGHT));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetch).toHaveBeenCalledTimes(MAX_IN_FLIGHT);
    // One finishes: the next starts.
    answersFor[0]?.(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(MAX_IN_FLIGHT + 1));
    for (const answer of answersFor.slice(1)) {
      answer(new Response(null, { status: 204 }));
    }
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(jobs.length));
    for (const answer of answersFor) {
      answer(new Response(null, { status: 204 }));
    }
    expect(MAX_IN_FLIGHT * 2).toBeLessThanOrEqual(10);
  });

  it('waits longer for each retry, never past its cap, whatever the draw', () => {
    for (const draw of [0, 0.3, 0.999]) {
      const waits = [1, 2, 3, 4, 5, 6, 7].map((retry) => backoff(retry, RETRY, () => draw));
      for (const [i, wait] of waits.entries()) {
        const step = Math.min(RETRY.capMs, RETRY.baseMs * 2 ** i);
        expect(wait).toBeGreaterThanOrEqual(step / 2);
        expect(wait).toBeLessThanOrEqual(step);
      }
      expect(waits.at(-1)).toBeLessThanOrEqual(RETRY.capMs);
    }
    // About a minute of tries in all, at most: enough for the worker to restart.
    const most = [1, 2, 3, 4, 5].reduce((sum, retry) => sum + backoff(retry, RETRY, () => 1), 0);
    expect(most).toBeLessThanOrEqual(90_000);
    expect(RETRY.attempts).toBeGreaterThan(1);
  });

  describe('jobs a listing finds open', () => {
    const waited = (waitedMs: number): WaitingExtraction => ({ ...JOB, waitedMs });

    it('hands over again a job open for a few minutes, not one just requested', async () => {
      const fetch = answers(204);
      const { dispatch } = dispatchWith(fetch);
      dispatch.waiting([waited(REDELIVER_AFTER_MS - 1_000)]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch).not.toHaveBeenCalled();
      dispatch.waiting([waited(REDELIVER_AFTER_MS)]);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    });

    it('leaves a job on its way alone, and one this replica tried lately', async () => {
      let clock = 1_000_000;
      let answer: (response: Response) => void = () => undefined;
      const fetch = vi.fn(
        (_url: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            void text(init?.body as ReadableStream);
            answer = resolve;
          }),
      );
      const { dispatch } = dispatchWith(fetch, { now: () => clock });
      dispatch.dispatch(JOB);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      // On its way (waiting in the worker's queue): not sent twice.
      dispatch.waiting([waited(REDELIVER_AFTER_MS * 2)]);
      expect(fetch).toHaveBeenCalledTimes(1);
      // The worker has it from another replica: 409. Not sent again until a few minutes have passed.
      answer(new Response(null, { status: 409 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      clock += REDELIVER_AFTER_MS - 1;
      dispatch.waiting([waited(REDELIVER_AFTER_MS * 3)]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch).toHaveBeenCalledTimes(1);
      clock += 1;
      dispatch.waiting([waited(REDELIVER_AFTER_MS * 3)]);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });

    it('reports jobs open far longer than any takes, together, at most every half hour, and still hands them over', async () => {
      let clock = 1_000_000;
      const fetch = answers(204);
      const { dispatch, stale } = dispatchWith(fetch, { now: () => clock });
      const other = { ...JOB, jobId: '0190f8c4-0000-7000-8000-000000000a02' };
      dispatch.waiting([waited(STALE_AFTER_MS - 1)]);
      expect(stale).toEqual([]);
      dispatch.waiting([
        waited(STALE_AFTER_MS),
        { ...other, waitedMs: STALE_AFTER_MS * 2 },
        waited(1),
      ]);
      // One report for the backlog, naming only the jobs past the limit.
      expect(stale).toEqual([[waited(STALE_AFTER_MS), { ...other, waitedMs: STALE_AFTER_MS * 2 }]]);
      clock += STALE_REPORT_EVERY_MS - 1;
      dispatch.waiting([waited(STALE_AFTER_MS + 60_000)]);
      expect(stale).toHaveLength(1);
      clock += 1;
      dispatch.waiting([waited(STALE_AFTER_MS + 60_000)]);
      expect(stale).toHaveLength(2);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      // An hour at least: twice the longest a job can take once handed over.
      expect(STALE_AFTER_MS).toBeGreaterThanOrEqual(60 * 60_000);
    });

    it('stops handing over by itself a job that failed for good, until someone asks again', async () => {
      let clock = 1_000_000;
      const fetch = answers(500, 204);
      const { dispatch, errors } = dispatchWith(fetch, { now: () => clock });
      dispatch.dispatch(JOB);
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]?.transient).toBe(false);
      clock += REDELIVER_AFTER_MS * 10;
      dispatch.waiting([waited(REDELIVER_AFTER_MS * 20)]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch).toHaveBeenCalledTimes(1);
      // Asking again (the source's button) tries at once.
      dispatch.dispatch(JOB);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    });

    it('gives up on a job the worker keeps going away with, and says so', async () => {
      let clock = 1_000_000;
      const fetch = answers(wentAway());
      const { dispatch, errors } = dispatchWith(fetch, { now: () => clock });
      dispatch.dispatch(JOB);
      for (let lost = 1; lost <= MAX_LOST + 2; lost += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        clock += REDELIVER_AFTER_MS;
        dispatch.waiting([waited(REDELIVER_AFTER_MS * 20)]);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch).toHaveBeenCalledTimes(MAX_LOST);
      expect(errors.map(({ transient }) => transient)).toEqual([
        ...Array<boolean>(MAX_LOST - 1).fill(true),
        false,
      ]);
      expect(errors.at(-1)?.message).toMatch(/went away 3 times/);
    });
  });
});
