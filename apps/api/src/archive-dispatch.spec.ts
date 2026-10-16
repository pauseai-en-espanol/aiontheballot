import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { FetcherClient } from './fetcher-client.js';

import { createArchiveDispatch } from './archive-dispatch.js';

const ARCHIVE = 'https://archive.example.org';
const PAGE = 'https://partido-ejemplo-a.example.org/programa';
const SNAPSHOT = `${ARCHIVE}/web/20261013120000/${PAGE}`;
const TOKEN = 'un-secreto-de-prueba-de-mas-de-32-caracteres';

/** A fake worker: records what it is handed, answering each in turn from `answers` (204 once they run out). */
const handed: { path: string; authorization: string | undefined; body: unknown }[] = [];
let answers: number[] = [];
let worker: Server;
let workerUrl: string;

beforeAll(async () => {
  worker = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      handed.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body: JSON.parse(body) as unknown,
      });
      response.writeHead(answers.shift() ?? 204).end();
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve));
  const address = worker.address();
  workerUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise((resolve) => worker.close(resolve));
});

beforeEach(() => {
  handed.length = 0;
  answers = [];
});

/** A fake fetcher whose archive answers `snapshot`, counting what it was asked. */
const fetcherAnswering = (snapshot: { archiveUrl: string | null } | 'unavailable') => {
  const asked: string[] = [];
  const fetcher: FetcherClient = {
    fetchCopy: async () => ({ problem: 'unavailable' }),
    archive: async (url) => {
      asked.push(url);
      return snapshot;
    },
  };
  return { asked, fetcher };
};

const JOB = '0192a7c4-0000-7000-8000-000000000001';

describe('archive jobs (S4, ADR-0007 §4)', () => {
  it("asks the fetcher for the source's snapshot and hands the worker its address", async () => {
    const { asked, fetcher } = fetcherAnswering({ archiveUrl: SNAPSHOT });
    const errors: Error[] = [];
    const dispatch = createArchiveDispatch({
      fetcher,
      workerUrl,
      token: TOKEN,
      archiveUrl: ARCHIVE,
      onError: (error) => errors.push(error),
    });
    dispatch.dispatch({ jobId: JOB, url: PAGE });
    dispatch.dispatch({ jobId: JOB, url: PAGE });
    await dispatch.idle();
    expect(asked).toEqual([PAGE]);
    expect(handed).toEqual([
      {
        path: `/archives/${JOB}`,
        authorization: `Bearer ${TOKEN}`,
        body: { archiveUrl: SNAPSHOT },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it("hands the worker none for the archive's refusal, or for an address not under the archive's", async () => {
    for (const snapshot of [null, `https://otro.example.org/web/20261013120000/${PAGE}`]) {
      handed.length = 0;
      const dispatch = createArchiveDispatch({
        fetcher: fetcherAnswering({ archiveUrl: snapshot }).fetcher,
        workerUrl,
        token: TOKEN,
        archiveUrl: ARCHIVE,
      });
      dispatch.dispatch({ jobId: JOB, url: PAGE });
      await dispatch.idle();
      expect(
        handed.map(({ body }) => body),
        String(snapshot),
      ).toEqual([{ archiveUrl: null }]);
    }
  });

  it('leaves the job open when the fetcher is away, and reports it', async () => {
    const errors: Error[] = [];
    const dispatch = createArchiveDispatch({
      fetcher: fetcherAnswering('unavailable').fetcher,
      workerUrl,
      token: TOKEN,
      archiveUrl: ARCHIVE,
      onError: (error) => errors.push(error),
    });
    dispatch.dispatch({ jobId: JOB, url: PAGE });
    await dispatch.idle();
    expect(handed).toEqual([]);
    expect(errors.map(({ message }) => message)).toEqual([
      'The fetcher could not be reached for an archive',
    ]);
  });

  it('tries the worker again while it is busy, and stops at a refusal', async () => {
    answers = [503, 204];
    const dispatch = createArchiveDispatch({
      fetcher: fetcherAnswering({ archiveUrl: SNAPSHOT }).fetcher,
      workerUrl,
      token: TOKEN,
      archiveUrl: ARCHIVE,
      retryWaitMs: 1,
    });
    dispatch.dispatch({ jobId: JOB, url: PAGE });
    await dispatch.idle();
    expect(handed).toHaveLength(2);

    handed.length = 0;
    answers = [400];
    const errors: Error[] = [];
    const refused = createArchiveDispatch({
      fetcher: fetcherAnswering({ archiveUrl: SNAPSHOT }).fetcher,
      workerUrl,
      token: TOKEN,
      archiveUrl: ARCHIVE,
      retryWaitMs: 1,
      onError: (error) => errors.push(error),
    });
    refused.dispatch({ jobId: JOB, url: PAGE });
    await refused.idle();
    expect(handed).toHaveLength(1);
    expect(errors.map(({ message }) => message)).toEqual(['The worker refused an archive: 400']);
  });

  it('asks again for a job a listing finds waiting, once it has waited and was not tried lately', async () => {
    let clock = 0;
    const { asked, fetcher } = fetcherAnswering('unavailable');
    const dispatch = createArchiveDispatch({
      fetcher,
      workerUrl,
      token: TOKEN,
      archiveUrl: ARCHIVE,
      redeliverAfterMs: 1_000,
      now: () => clock,
    });
    // Too recent.
    dispatch.waiting([{ jobId: JOB, url: PAGE, waitedMs: 999 }]);
    await dispatch.idle();
    expect(asked).toEqual([]);
    dispatch.waiting([{ jobId: JOB, url: PAGE, waitedMs: 1_000 }]);
    await dispatch.idle();
    expect(asked).toEqual([PAGE]);
    // Tried just now: not again until as long has passed.
    clock = 500;
    dispatch.waiting([{ jobId: JOB, url: PAGE, waitedMs: 1_500 }]);
    await dispatch.idle();
    expect(asked).toHaveLength(1);
    clock = 1_000;
    dispatch.waiting([{ jobId: JOB, url: PAGE, waitedMs: 2_000 }]);
    await dispatch.idle();
    expect(asked).toHaveLength(2);
  });
});
