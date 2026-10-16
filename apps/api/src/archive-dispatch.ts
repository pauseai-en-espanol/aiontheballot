import type { ArchiveDispatch, ArchiveJob, WaitingArchive } from './admin/sources.js';
import type { FetcherClient } from './fetcher-client.js';

import { isSnapshotUrl } from './fetcher/archive.js';

/** A job still open this long after it was requested is asked for again when a member lists its sources. */
export const ARCHIVE_REDELIVER_AFTER_MS = 15 * 60_000;
/** Jobs waiting here for their turn, at most; the rest wait for the next listing. */
const MAX_QUEUED = 50;
/** Jobs remembered per replica, for when each was last asked for. */
const REMEMBERED = 1_000;
/** Tries to hand the worker an archive's result, the first included, a few seconds apart. */
const WORKER_TRIES = 3;
const WORKER_TIMEOUT_MS = 30_000;

/** Why an archive job stays open: reported by the caller, by class only. */
export class ArchiveHandoverFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveHandoverFailed';
  }
}

/**
 * Archive jobs (S4; ADR-0007 §4), after their transaction committed and in the background, one at a time per replica:
 * asks the fetcher for a snapshot of the source's URL (it waits for the archive, up to minutes), then hands the worker
 * the snapshot's address, or none, at `POST /archives/{job}`, where it is recorded in the requester's name and the job
 * finished. A snapshot not under the archive's own address is taken as none. If the fetcher or the worker can't be
 * reached, the job stays open, and a member's listing asks for it again once it has waited
 * `ARCHIVE_REDELIVER_AFTER_MS` and this replica hasn't tried it for as long. Nothing is retried in a loop: a missing
 * snapshot is a warning (W12), and the archive limits captures per URL.
 */
export const createArchiveDispatch = ({
  fetcher,
  workerUrl,
  token,
  archiveUrl,
  onError = () => undefined,
  redeliverAfterMs = ARCHIVE_REDELIVER_AFTER_MS,
  retryWaitMs = 2_000,
  now = Date.now,
}: {
  fetcher: FetcherClient;
  workerUrl: string;
  /** The worker's secret (WORKER_TOKEN). */
  token: string;
  /** The archive's address (ARCHIVE_URL), which every snapshot's must start with. */
  archiveUrl: string;
  onError?: (error: Error) => void;
  redeliverAfterMs?: number;
  retryWaitMs?: number;
  now?: () => number;
}): ArchiveDispatch & { idle: () => Promise<void> } => {
  const queue: ArchiveJob[] = [];
  const queued = new Set<string>();
  const tried = new Map<string, number>();
  let running: Promise<void> | undefined;
  /** The job being asked for now: never queued again meanwhile. */
  let current: string | undefined;

  const remember = (jobId: string) => {
    tried.delete(jobId);
    tried.set(jobId, now());
    if (tried.size > REMEMBERED) {
      const oldest = tried.keys().next();
      if (!oldest.done) {
        tried.delete(oldest.value);
      }
    }
  };

  /** Hands the worker the result: true once it recorded it, or the job was no longer open (404). */
  const handOver = async (jobId: string, snapshot: string | null): Promise<boolean> => {
    for (let attempt = 1; attempt <= WORKER_TRIES; attempt += 1) {
      try {
        const answer = await fetch(new URL(`/archives/${jobId}`, workerUrl), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ archiveUrl: snapshot }),
          signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
        });
        if (answer.status === 204 || answer.status === 404) {
          return true;
        }
        if (answer.status !== 503 && answer.status !== 502 && answer.status !== 504) {
          onError(new ArchiveHandoverFailed(`The worker refused an archive: ${answer.status}`));
          return false;
        }
      } catch {
        // Not reached: tried again below, then left for the next listing.
      }
      if (attempt < WORKER_TRIES) {
        await new Promise((resolve) => setTimeout(resolve, retryWaitMs * attempt));
      }
    }
    onError(new ArchiveHandoverFailed('The worker could not be reached with an archive'));
    return false;
  };

  const run = async (job: ArchiveJob) => {
    const answer = await fetcher.archive(job.url);
    if (answer === 'unavailable') {
      // The fetcher couldn't be asked: nothing happened, and the job waits for the next listing.
      onError(new ArchiveHandoverFailed('The fetcher could not be reached for an archive'));
      return;
    }
    const snapshot =
      answer.archiveUrl !== null && isSnapshotUrl(answer.archiveUrl, archiveUrl)
        ? answer.archiveUrl
        : null;
    await handOver(job.jobId, snapshot);
  };

  const drain = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      queued.delete(job.jobId);
      current = job.jobId;
      remember(job.jobId);
      try {
        await run(job);
      } catch (error) {
        onError(error instanceof Error ? error : new Error('An archive job failed'));
      }
      current = undefined;
      remember(job.jobId);
    }
    running = undefined;
  };

  const enqueue = (job: ArchiveJob) => {
    if (queued.has(job.jobId) || current === job.jobId || queue.length >= MAX_QUEUED) {
      return;
    }
    queued.add(job.jobId);
    queue.push(job);
    running ??= drain();
  };

  return {
    dispatch: enqueue,
    waiting: (jobs: WaitingArchive[]) => {
      for (const job of jobs) {
        const last = tried.get(job.jobId);
        if (
          job.waitedMs >= redeliverAfterMs &&
          (last === undefined || now() - last >= redeliverAfterMs)
        ) {
          enqueue({ jobId: job.jobId, url: job.url });
        }
      }
    },
    idle: async () => {
      while (running) {
        await running;
      }
    },
  };
};
