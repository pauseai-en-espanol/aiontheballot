import { Readable } from 'node:stream';

/**
 * The API's side of the fetcher (ADR-0007): asks it for a URL's bytes, or for an archive snapshot, with the secret the
 * two share. The fetcher alone connects to the internet; the API only ever connects to it.
 */

/** Why a URL gave no copy, as the member hears it. */
export type FetchProblem =
  /** An address the fetcher may not reach (not public, not http or https, a port other than 80 or 443). */
  | 'refused'
  /** The site answered with an error, too slowly, or not at all. */
  | 'failed'
  /** More than a copy may be. */
  | 'tooLarge'
  /** A type no copy may have. */
  | 'fileType'
  /** The fetcher itself couldn't be asked, or was busy. */
  | 'unavailable';

export interface FetchedCopy {
  /** The type the bytes are, as the site declared it or their first bytes show; undefined when neither says. */
  contentType: string | undefined;
  /** Where they came from, after redirects. */
  finalUrl: string;
  /** The bytes, as they arrive; destroyed if they aren't wanted after all. */
  body: Readable;
}

export interface FetcherClient {
  fetchCopy: (url: string) => Promise<FetchedCopy | { problem: FetchProblem }>;
  /**
   * What the archive gave: a snapshot's address, or `null` when it gave none; or `'unavailable'` when the fetcher
   * couldn't be asked.
   */
  archive: (url: string) => Promise<{ archiveUrl: string | null } | 'unavailable'>;
}

/** Past the fetcher's own deadline (8 s by default, 10 s at most) and the bytes' way here, within the admin's 15 s. */
const FETCH_TIMEOUT_MS = 12_000;
/** Past the archive's wait (5 minutes) in the fetcher. */
const ARCHIVE_TIMEOUT_MS = 6 * 60_000;

const PROBLEMS: Record<string, FetchProblem> = {
  scheme: 'refused',
  address: 'refused',
  redirects: 'refused',
  status: 'failed',
  unreachable: 'failed',
  timeout: 'failed',
  tooLarge: 'tooLarge',
  fileType: 'fileType',
};

export const createFetcherClient = ({
  url: fetcherUrl,
  token,
  onError = () => undefined,
}: {
  /** The fetcher inside the cluster (FETCHER_URL). */
  url: string;
  /** The secret the two share (FETCHER_TOKEN). */
  token: string;
  /** The fetcher's answers that are nobody's doing but ours (a secret it refuses, its own fault): reported. */
  onError?: (error: Error) => void;
}): FetcherClient => {
  const unexpected = (door: string, status: number) => {
    if (status === 401 || status === 500 || status === 400) {
      onError(new Error(`The fetcher refused ${door}: ${status}`));
    }
  };
  const post = (path: string, url: string, timeoutMs: number) =>
    fetch(new URL(path, fetcherUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  return {
    fetchCopy: async (url) => {
      let answer: Response;
      try {
        answer = await post('/fetch', url, FETCH_TIMEOUT_MS);
      } catch {
        return { problem: 'unavailable' };
      }
      if (answer.status === 200 && answer.body) {
        return {
          contentType: answer.headers.get('x-copy-type') ?? undefined,
          finalUrl: answer.headers.get('x-final-url') ?? url,
          body: Readable.fromWeb(
            answer.body as import('node:stream/web').ReadableStream<Uint8Array>,
          ),
        };
      }
      unexpected('a fetch', answer.status);
      const reason = await answer
        .json()
        .then((body: unknown) => (body as { error?: unknown } | null)?.error)
        .catch(() => undefined);
      return { problem: (typeof reason === 'string' && PROBLEMS[reason]) || 'unavailable' };
    },
    archive: async (url) => {
      try {
        const answer = await post('/archive', url, ARCHIVE_TIMEOUT_MS);
        if (answer.status !== 200) {
          unexpected('an archive', answer.status);
          return answer.status === 422 ? { archiveUrl: null } : 'unavailable';
        }
        const { archiveUrl } = (await answer.json()) as { archiveUrl?: unknown };
        return { archiveUrl: typeof archiveUrl === 'string' ? archiveUrl : null };
      } catch {
        return 'unavailable';
      }
    },
  };
};
