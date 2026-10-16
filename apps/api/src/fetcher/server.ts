import Fastify, { type FastifyInstance } from 'fastify';

import type { Snapshot } from './archive.js';

import { isCopyType } from '../copy-types.js';
import { bearerMatches } from '../worker/token.js';
import { copyType, type Fetched, FetchRefused } from './fetch-url.js';

/** The longest URL taken: well past any party's document, short of anything abusive. */
export const MAX_URL_LENGTH = 2048;

/** The answer's status for each reason a URL gave no copy; the reason goes in the body, for the member. */
const REFUSAL_STATUS: Record<FetchRefused['reason'], number> = {
  scheme: 422,
  address: 422,
  redirects: 422,
  status: 502,
  unreachable: 502,
  timeout: 504,
  tooLarge: 413,
};

/**
 * The fetcher's doors (ADR-0007 §1), for the API alone: the network allows nobody else, and a request without the
 * secret the two share is refused (401) before its body is read.
 *
 * - `POST /fetch` with `{ url }`: 200 with the bytes the URL serves (as `application/octet-stream`), their type in
 *   `x-copy-type` and the address they came from in `x-final-url`; or why not, as `{ error, status? }`: 422 a URL it
 *   may not fetch, 502 the site's error or no answer, 504 too slow, 413 too large, 415 a type no copy may have.
 * - `POST /archive` with `{ url }`: 200 with `{ archiveUrl }` (`null` when the archive gave none, with a `reason`).
 *
 * Past `maxFetches` fetches or `maxArchives` captures at once it answers 503. Its own faults go to `onFault`, by their
 * class only. `GET /healthz` is the probe, open to the kubelet.
 */
export const buildFetcherApp = ({
  token,
  fetchUrl,
  archive,
  maxFetches = 4,
  maxArchives = 2,
  onFault = () => undefined,
  logger = false,
}: {
  /** The secret shared with the API (FETCHER_TOKEN). */
  token: string;
  fetchUrl: (url: string) => Promise<Fetched>;
  archive: (url: string) => Promise<Snapshot>;
  maxFetches?: number;
  maxArchives?: number;
  onFault?: (error: Error) => void;
  logger?: boolean | { level: string };
}): FastifyInstance => {
  // A capture can take minutes: longer than Node's own default for a whole request is fine, but bounded.
  const app = Fastify({ logger, requestTimeout: 10 * 60_000, bodyLimit: 16 * 1024 });
  let fetching = 0;
  let archiving = 0;

  app.get('/healthz', async () => ({ status: 'ok' }));

  const body = {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 1, maxLength: MAX_URL_LENGTH } },
  } as const;

  app.register(async (doors) => {
    doors.addHook('onRequest', async (request, reply) => {
      if (!bearerMatches(request.headers.authorization, token)) {
        request.log.warn('A request came without the shared secret');
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return undefined;
    });

    doors.post<{ Body: { url: string } }>(
      '/fetch',
      { schema: { body } },
      async (request, reply) => {
        if (fetching >= maxFetches) {
          return reply.code(503).send({ error: 'busy' });
        }
        // The slot is held until the copy has left, or the connection went: until then its bytes are in memory.
        fetching += 1;
        let held = true;
        const release = () => {
          if (held) {
            held = false;
            fetching -= 1;
          }
        };
        reply.raw.once('close', release);
        reply.raw.once('finish', release);
        try {
          const fetched = await fetchUrl(request.body.url);
          const type = copyType(fetched.contentType, fetched.bytes);
          // A type no copy may have is refused here, its bytes never sent.
          if (!isCopyType(type)) {
            release();
            return reply.code(415).send({ error: 'fileType' });
          }
          return reply
            .code(200)
            .header('content-type', 'application/octet-stream')
            .header('x-copy-type', type)
            .header('x-final-url', fetched.finalUrl)
            .send(fetched.bytes);
        } catch (error) {
          release();
          if (error instanceof FetchRefused) {
            // The member's to hear: what the site did is no fault of the fetcher's.
            return reply
              .code(REFUSAL_STATUS[error.reason])
              .send(
                error.status === undefined
                  ? { error: error.reason }
                  : { error: error.reason, status: error.status },
              );
          }
          const reason = error instanceof Error ? error.name : 'unknown';
          request.log.error({ reason }, 'A fetch failed');
          onFault(new Error(`A fetch failed: ${reason}`));
          return reply.code(500).send({ error: 'internal' });
        }
      },
    );

    doors.post<{ Body: { url: string } }>(
      '/archive',
      { schema: { body } },
      async (request, reply) => {
        if (archiving >= maxArchives) {
          return reply.code(503).send({ error: 'busy' });
        }
        // The archive fetches it, not the fetcher; still, only a web page's address is passed on.
        const url = URL.parse(request.body.url);
        if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          return reply.code(422).send({ error: 'scheme' });
        }
        archiving += 1;
        try {
          const snapshot = await archive(url.href);
          if (snapshot.archiveUrl === null) {
            request.log.warn({ reason: snapshot.reason }, 'The archive gave no snapshot');
          }
          return reply.code(200).send(snapshot);
        } finally {
          archiving -= 1;
        }
      },
    );
  });
  return app;
};
