/**
 * Archive snapshots (editorial workflow S4, O1; ADR-0007 §4): the Internet Archive's Save Page Now, as its public API
 * documents it (checked 2026-10-13). `POST {archive}/save` takes the URL and answers with a job; `GET
 * {archive}/save/status/{job}` answers pending, success (the capture's timestamp and original URL) or error. A
 * capture takes from seconds to minutes. An archive.org account's S3 keys raise its limits a lot (3 captures a minute
 * and 200 a day without them); they are optional.
 */

export interface ArchiveOptions {
  /** The archive's address (`ARCHIVE_URL`): https, with no path. */
  archiveUrl: string;
  /** An archive.org account's S3 keys, if any. */
  keys?: { access: string; secret: string };
  /** How long to wait for the capture, all told. */
  deadlineMs?: number;
  /** How often to ask how the capture is going. */
  pollMs?: number;
  /** The HTTP client: global fetch, unless a test says otherwise. */
  fetch?: typeof fetch;
}

/** A snapshot's address, or why there is none (for the logs; a missing snapshot is a warning, W12). */
export type Snapshot =
  | { archiveUrl: string }
  | { archiveUrl: null; reason: 'refused' | 'failed' | 'timeout' | 'unavailable' };

/** A capture's timestamp, as the archive writes it in its addresses: YYYYMMDDhhmmss. */
const TIMESTAMP = /^\d{14}$/u;

/** The archive's address as configured: https, no user name, nothing after the host. */
export const readArchiveUrl = (value: string | undefined): string => {
  const archive = new URL(value || 'https://web.archive.org');
  if (
    archive.protocol !== 'https:' ||
    archive.username !== '' ||
    archive.password !== '' ||
    (archive.pathname !== '/' && archive.pathname !== '') ||
    archive.search !== '' ||
    archive.hash !== ''
  ) {
    throw new Error('ARCHIVE_URL must be an https origin, with no path');
  }
  return archive.origin;
};

/** Whether `value` is a snapshot's address under the archive's: `{archive}/web/{timestamp}/{http(s) URL}`. */
export const isSnapshotUrl = (value: string, archiveUrl: string): boolean => {
  const prefix = `${archiveUrl}/web/`;
  if (!value.startsWith(prefix) || value.length > 4096) {
    return false;
  }
  const [timestamp, ...rest] = value.slice(prefix.length).split('/');
  const original = rest.join('/');
  return (
    TIMESTAMP.test(timestamp ?? '') &&
    (original.startsWith('http://') || original.startsWith('https://'))
  );
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jsonOf = async (response: Response): Promise<Record<string, unknown> | undefined> => {
  try {
    const value: unknown = await response.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Asks the archive to capture `url` and waits for the snapshot's address. Never throws: no snapshot is a warning. */
export const archiveSnapshot = async (url: string, options: ArchiveOptions): Promise<Snapshot> => {
  const {
    archiveUrl,
    keys,
    deadlineMs = 5 * 60_000,
    pollMs = 5_000,
    fetch: send = fetch,
  } = options;
  const deadline = Date.now() + deadlineMs;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (keys) {
    headers.authorization = `LOW ${keys.access}:${keys.secret}`;
  }
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - Date.now())));
  let job: unknown;
  try {
    const capture = await send(`${archiveUrl}/save`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url, skip_first_archive: '1' }).toString(),
      signal: signal(),
      redirect: 'manual',
    });
    if (!capture.ok) {
      return { archiveUrl: null, reason: capture.status === 429 ? 'refused' : 'unavailable' };
    }
    job = (await jsonOf(capture))?.job_id;
  } catch {
    return { archiveUrl: null, reason: 'unavailable' };
  }
  if (typeof job !== 'string' || !/^[\w.-]{1,200}$/u.test(job)) {
    return { archiveUrl: null, reason: 'refused' };
  }
  while (Date.now() + pollMs < deadline) {
    await wait(pollMs);
    let status: Record<string, unknown> | undefined;
    try {
      const answer = await send(`${archiveUrl}/save/status/${job}`, {
        headers,
        signal: signal(),
        redirect: 'manual',
      });
      // Busy, or a moment's fault: asked again, until the deadline.
      status = answer.ok ? await jsonOf(answer) : undefined;
    } catch {
      status = undefined;
    }
    if (status?.status === 'error') {
      return { archiveUrl: null, reason: 'failed' };
    }
    if (status?.status === 'success') {
      const { timestamp, original_url: original } = status;
      const snapshot = `${archiveUrl}/web/${String(timestamp)}/${String(original)}`;
      return typeof timestamp === 'string' &&
        typeof original === 'string' &&
        isSnapshotUrl(snapshot, archiveUrl)
        ? { archiveUrl: snapshot }
        : { archiveUrl: null, reason: 'failed' };
    }
  }
  return { archiveUrl: null, reason: 'timeout' };
};
