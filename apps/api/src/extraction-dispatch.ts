import type { FileStore } from '@aiontheballot/db/file-store';

import { Readable } from 'node:stream';
import { setTimeout as sleepFor } from 'node:timers/promises';

import type { ExtractionDispatch, ExtractionJob, WaitingExtraction } from './admin/sources.js';

import { WORKER_REQUEST_MS } from './worker/server.js';

/**
 * Why a handover failed, which decides what follows (ADR-0006 §2):
 * - `transient`: the worker couldn't be reached, or said "not now" (503, or 429, 502, 504 from anything between):
 *   nothing was parsed, so it is tried again soon, and redelivered later;
 * - `lost`: the connection went after the worker had the job: it may have restarted, or died on the document (a
 *   decompression bomb past its memory limit). Not tried again at once; redelivered later, a few times at most;
 * - `final`: anything another try would only repeat (401, 422, 500, a missing or damaged copy, a job held past the
 *   worker's window): reported, and never handed over again by itself, only when someone asks.
 */
type FailureKind = 'transient' | 'lost' | 'final';

class HandoverFailed extends Error {
  readonly kind: FailureKind;

  constructor(message: string, kind: FailureKind) {
    super(message);
    this.kind = kind;
  }
}

/** Answers that say "not now": busy, unavailable, or a gateway's. */
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
/** Failures to connect at all, as Node's fetch gives them (the error's cause): nothing reached the worker. */
const CONNECT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** The system error code behind a failed fetch, if any: on its cause, or on the first of an AggregateError's. */
const causeCode = (error: unknown): string | undefined => {
  const cause = (error as { cause?: unknown } | undefined)?.cause as
    { code?: unknown; errors?: unknown[] } | undefined;
  const code = cause?.code ?? (cause?.errors?.[0] as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
};

/** How the API retries a handover that failed for a reason that may pass (ADR-0006). */
export interface RetryPolicy {
  /** Tries in all, the first included. */
  attempts: number;
  /** The wait before the first retry, doubled for each one after, up to `capMs`. */
  baseMs: number;
  capMs: number;
}

/** About a minute of tries in all: a worker that restarts (its self-check included) is back within it. */
export const RETRY: RetryPolicy = { attempts: 6, baseMs: 2_000, capMs: 30_000 };
/** A job still open this long after it was requested is handed over again when a member lists its sources. */
export const REDELIVER_AFTER_MS = 5 * 60_000;
/** Twice the longest a job can take once handed over (its wait in the worker's queue and its run): then it's reported. */
export const STALE_AFTER_MS = 2 * WORKER_REQUEST_MS;
/** Stale jobs are reported together, at most this often per replica: a backlog is one report, not one per job. */
export const STALE_REPORT_EVERY_MS = 30 * 60_000;
/** How often a job may lose the worker before it is handed over again only when someone asks. */
export const MAX_LOST = 3;
/**
 * Handovers one replica has on their way at once, each waiting in the worker's queue or running there: two replicas'
 * stay under the worker's 10 waiting, so a backlog waits here rather than being turned away there.
 */
export const MAX_IN_FLIGHT = 4;
/** Jobs waiting here for a place on their way, at most; the rest wait for the next listing. */
const MAX_QUEUED = 100;
/** Jobs remembered per replica, for when each was last handed over and how it went. */
const REMEMBERED = 1_000;

/**
 * The wait before retry `retry` (1 for the first): exponential, capped, with "equal jitter", half of it fixed and half
 * random, so the waits grow whatever the draw while replicas that failed together don't retry together.
 */
export const backoff = (retry: number, policy: RetryPolicy, random: () => number): number => {
  const step = Math.min(policy.capMs, policy.baseMs * 2 ** (retry - 1));
  return step / 2 + random() * (step / 2);
};

/** A map that forgets its oldest entries past `max`. */
const bounded = <K, V>(max: number) => {
  const map = new Map<K, V>();
  return {
    get: (key: K) => map.get(key),
    set: (key: K, value: V) => {
      map.delete(key);
      map.set(key, value);
      if (map.size > max) {
        const oldest = map.keys().next();
        if (!oldest.done) {
          map.delete(oldest.value);
        }
      }
    },
  };
};

/** What this replica remembers of a job it handed over. */
interface JobState {
  /** When it last finished trying. */
  tried: number;
  /** How often the worker went away while it had the job. */
  lost: number;
  /** Not to be handed over again by itself: only when someone asks. */
  final: boolean;
}

/**
 * Hands extraction jobs to the worker (PLAN R116, R133, R146; ADR-0006): streams the job's copy from the file store,
 * which the worker never mounts, to it, never holding the copy in memory, with the secret the worker shares with the
 * API. After the job's transaction committed, and in the background, a few at a time (`maxInFlight`): a handover that
 * fails before the worker had the job is tried again, a bounded number of times with growing, jittered waits; one that
 * still fails, or that fails otherwise, leaves the job open (see FailureKind). Open jobs are found again when a member
 * lists their sources (`waiting`): those open for a few minutes, not on their way and not given up on are handed over
 * again, and those open far longer than a job can take are reported, together. A job already on its way isn't sent
 * again by this replica; the worker refuses one it already has.
 */
export const createExtractionDispatch = ({
  workerUrl,
  token,
  files,
  onError,
  onStale,
  fetch: fetchImpl = fetch,
  // Longer than the worker takes a request for (its queue and its job), so the worker, not the API, gives up first.
  timeoutMs = WORKER_REQUEST_MS + 60_000,
  retry = RETRY,
  redeliverAfterMs = REDELIVER_AFTER_MS,
  staleAfterMs = STALE_AFTER_MS,
  staleReportEveryMs = STALE_REPORT_EVERY_MS,
  maxInFlight = MAX_IN_FLIGHT,
  sleep = (ms: number) => sleepFor(ms, undefined, { ref: false }),
  random = Math.random,
  now = Date.now,
}: {
  workerUrl: string;
  /** The secret the worker checks on every job (WORKER_TOKEN): never logged. */
  token: string;
  files: FileStore;
  /**
   * Never the bytes or the text: only that a job couldn't be handed over, and why in a word. `transient` when it will
   * be handed over again by itself (the worker was away, busy, or went away once): the job waits for its sources to
   * be listed. Otherwise someone has to look, and ask for the text again.
   */
  onError: (error: Error, transient: boolean) => void;
  /** Jobs open for longer than any can take: something keeps them from the worker. Their ids and waits only. */
  onStale: (jobs: WaitingExtraction[]) => void;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retry?: RetryPolicy;
  redeliverAfterMs?: number;
  staleAfterMs?: number;
  staleReportEveryMs?: number;
  maxInFlight?: number;
  sleep?: (ms: number) => Promise<unknown>;
  random?: () => number;
  now?: () => number;
}): ExtractionDispatch & { sent: (job: ExtractionJob) => Promise<void> } => {
  /** Jobs on their way or waiting for a place, by id. */
  const onTheirWay = new Set<string>();
  const queued: ExtractionJob[] = [];
  let inFlight = 0;
  const states = bounded<string, JobState>(REMEMBERED);
  let staleReported: number | undefined;

  /** One try: resolves once the worker took the job (or had it, or finished it); rejects otherwise. */
  const sent = async ({ jobId, tenantId, sha256 }: ExtractionJob): Promise<void> => {
    const copy = await files.open({ tenantId, bucket: 'sources' }, sha256);
    if (!copy) {
      throw new HandoverFailed(
        `Extraction job ${jobId}: its copy is not in the file store`,
        'final',
      );
    }
    // The store checks the copy against its hash as it streams: a damaged copy fails the request on our side.
    let unreadable = false;
    copy.stream.once('error', () => {
      unreadable = true;
    });
    let response: Response;
    try {
      response = await fetchImpl(new URL(`/jobs/${encodeURIComponent(jobId)}`, workerUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/octet-stream',
          'content-length': String(copy.byteSize),
        },
        body: Readable.toWeb(copy.stream) as ReadableStream<Uint8Array>,
        // A streamed body: sent as it is read.
        duplex: 'half',
        signal: AbortSignal.timeout(timeoutMs),
      } as RequestInit);
    } catch (error) {
      if (unreadable) {
        throw new HandoverFailed(`Extraction job ${jobId}: its copy could not be read`, 'final');
      }
      // The worker held the job for its whole window: trying again won't go differently.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new HandoverFailed(
          `Extraction job ${jobId}: the worker took longer than its window`,
          'final',
        );
      }
      const code = causeCode(error);
      if (code !== undefined && CONNECT_CODES.has(code)) {
        throw new HandoverFailed(
          `Extraction job ${jobId}: the worker could not be reached (${code})`,
          'transient',
        );
      }
      throw new HandoverFailed(
        `Extraction job ${jobId}: the worker went away while it had the job (${code ?? 'no code'})`,
        'lost',
      );
    } finally {
      copy.stream.destroy();
    }
    // Nothing in the answer is needed beyond its status.
    await response.body?.cancel();
    // 404: already finished. 409: the worker has it already.
    if (response.ok || response.status === 404 || response.status === 409) {
      return;
    }
    // 503 (and 429, 502, 504 from anything in between): the worker busy, restarting or unable to run a parser, the job
    // left open. Anything else is for good, and reported: 401, a secret that isn't the worker's; 422, bytes that aren't
    // the source's copy (a damaged store, or a bug); 500, a fault the worker didn't expect, which trying again could
    // only repeat, parsing the document each time.
    throw new HandoverFailed(
      `Extraction job ${jobId}: the worker answered ${response.status}`,
      TRANSIENT_STATUSES.has(response.status) ? 'transient' : 'final',
    );
  };

  /** Tries until the worker takes the job, a failure that isn't transient, or the last try. */
  const handOver = async (job: ExtractionJob): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await sent(job);
        return;
      } catch (error) {
        if (
          !(error instanceof HandoverFailed) ||
          error.kind !== 'transient' ||
          attempt >= retry.attempts
        ) {
          throw error;
        }
        await sleep(backoff(attempt, retry, random));
      }
    }
  };

  /** What follows a handover that failed: whether the job may be handed over again by itself, and who hears of it. */
  const failed = (jobId: string, error: unknown, state: JobState): void => {
    const failure =
      error instanceof HandoverFailed
        ? error
        : new HandoverFailed(`Extraction job ${jobId} could not be handed over`, 'final');
    if (failure.kind === 'lost') {
      state.lost += 1;
      if (state.lost >= MAX_LOST) {
        state.final = true;
        onError(
          new Error(
            `Extraction job ${jobId}: the worker went away ${state.lost} times while it had the job; ` +
              'it waits for someone to ask for its text again',
          ),
          false,
        );
        return;
      }
      onError(failure, true);
      return;
    }
    if (failure.kind === 'final') {
      state.final = true;
    }
    onError(failure, failure.kind === 'transient');
  };

  /** Starts the next handovers waiting for a place. */
  const pump = (): void => {
    while (inFlight < maxInFlight && queued.length > 0) {
      const job = queued.shift() as ExtractionJob;
      inFlight += 1;
      const state = states.get(job.jobId) ?? { tried: 0, lost: 0, final: false };
      handOver(job)
        .catch((error: unknown) => failed(job.jobId, error, state))
        .finally(() => {
          state.tried = now();
          states.set(job.jobId, state);
          onTheirWay.delete(job.jobId);
          inFlight -= 1;
          pump();
        });
    }
  };

  const enqueue = (job: ExtractionJob): void => {
    if (onTheirWay.has(job.jobId) || queued.length >= MAX_QUEUED) {
      return;
    }
    onTheirWay.add(job.jobId);
    queued.push(job);
    pump();
  };

  return {
    sent,
    // Someone uploaded the copy, or asked for its text again: whatever happened before, it is tried now.
    dispatch: (job) => {
      const state = states.get(job.jobId);
      if (state) {
        states.set(job.jobId, { ...state, lost: 0, final: false });
      }
      enqueue(job);
    },
    waiting: (jobs) => {
      const stale = jobs.filter((job) => job.waitedMs >= staleAfterMs);
      if (
        stale.length > 0 &&
        (staleReported === undefined || now() - staleReported >= staleReportEveryMs)
      ) {
        staleReported = now();
        onStale(stale);
      }
      for (const job of jobs) {
        const state = states.get(job.jobId);
        // Open a few minutes, not given up on, and not handed over by this replica for as long: another replica's
        // handover may still be on its way, and the worker refuses it then.
        if (
          job.waitedMs >= redeliverAfterMs &&
          !state?.final &&
          (state === undefined || now() - state.tried >= redeliverAfterMs)
        ) {
          enqueue(job);
        }
      }
    },
  };
};
