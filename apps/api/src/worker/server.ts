import type { Database } from '@aiontheballot/db/client';
import type { IncomingMessage } from 'node:http';

import Fastify, { type FastifyInstance } from 'fastify';

import type { Extraction } from './extract.js';

import { limitUnreadBodies } from '../unread-body.js';
import { finishArchive, finishExtraction, isCopy, jobSource } from './jobs.js';
import { bearerMatches } from './token.js';

/** The document's fault (the parser gave up, ran out of time or memory): the job is finished, as failed. */
export interface Failed {
  status: 'failed';
}

/**
 * Extracts a copy's text: what it holds, or that the document made the parser fail. It rejects only for the worker's
 * own faults (a parser that couldn't be started), which leave the job open to be asked again.
 */
export type Extractor = (contentType: string, bytes: Uint8Array) => Promise<Extraction | Failed>;

/** The largest copy, as the files table's check has it. */
export const MAX_COPY_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

class Refused extends Error {
  readonly status: number;

  constructor(status: number, key: string) {
    super(key);
    this.status = status;
  }
}

/** One job at a time, the rest waiting their turn in order, at most `maxWaiting` of them. */
const createQueue = (maxWaiting: number) => {
  let tail: Promise<void> = Promise.resolve();
  let waiting = 0;
  return {
    /** Runs `fn` once every job before it is done; refuses at once when too many wait already. */
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (waiting >= maxWaiting) {
        throw new Refused(503, 'busy');
      }
      waiting += 1;
      const turn = tail;
      let done: () => void = () => undefined;
      tail = new Promise<void>((resolve) => {
        done = resolve;
      });
      try {
        await turn;
        waiting -= 1;
        return await fn();
      } finally {
        done();
      }
    },
  };
};

/** The request's body, at most `maxBytes` of it, read only now: until its job's turn it waits on the connection. */
const readCapped = async (body: IncomingMessage, maxBytes: number): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body.iterator({ destroyOnReturn: false })) {
    size += (chunk as Buffer).byteLength;
    if (size > maxBytes) {
      throw new Refused(413, 'tooLarge');
    }
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

/** How long a job may wait for its turn and run: the API waits a little longer for its answer (extraction-dispatch). */
export const WORKER_REQUEST_MS = 30 * 60_000;

/**
 * The worker's doors (PLAN R133; ADR-0006, ADR-0007), which only the API uses: `POST /archives/{id}` records an
 * archive job's snapshot (above), and `POST /jobs/{id}` with the job's copy as the body, which only the API
 * sends: the network allows nobody else, and a request without the secret the two share (`token`, as a bearer
 * credential) is refused (401) before anything else is looked at. Jobs run one at a time, each copy parsed in a child process of its own; while one runs,
 * the others wait with their bodies unread, so waiting costs no memory, and past `maxWaiting` the worker answers 503.
 * A job whose request is gone (the API gave up, or restarted) leaves the queue at once, and is skipped when its turn
 * comes. It answers once the job is finished: 204 done (the text, that there is none, or that the document failed, all
 * recorded), 404 for a job that isn't an open extraction, 409 for a job already here, 422 for bytes that aren't the
 * source's copy, 503 when the worker itself failed and left the job open, 500 for a fault it didn't expect (the job
 * left open too). Its own faults go to `onFault`, by their class only, never a message that could quote the document.
 * `GET /healthz` is the probe, open to the kubelet.
 */
export const buildWorkerApp = ({
  db,
  extractor,
  token,
  onFault = () => undefined,
  maxWaiting = 10,
  logger = false,
}: {
  db: Database;
  extractor: Extractor;
  /** The secret shared with the API (WORKER_TOKEN). */
  token: string;
  onFault?: (error: Error) => void;
  maxWaiting?: number;
  logger?: boolean | { level: string };
}): FastifyInstance => {
  // Waiting for a turn can take a while: longer than Node's own five minutes for a whole request.
  const app = Fastify({ logger, requestTimeout: WORKER_REQUEST_MS });
  // The body is left on the connection: read only once the job's turn comes, and only up to a copy's size.
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });
  // A body refused unread (a job that isn't open, one already here) is dropped within limits, then its connection
  // closed.
  limitUnreadBodies(app);
  const queue = createQueue(maxWaiting);
  /** The jobs here, running or waiting, each with its request's own token: the API asking twice parses nothing twice. */
  const here = new Map<string, symbol>();

  app.get('/healthz', async () => ({ status: 'ok' }));

  // An archive job's result (ADR-0007 §4): the snapshot's address the API got from the fetcher, or none. 204 recorded
  // and finished, 404 for a job that isn't an open archive job, 400 for an address that isn't an https URL.
  app.post<{ Params: { id: string }; Body: { archiveUrl: string | null } }>(
    '/archives/:id',
    {
      onRequest: async (request, reply) => {
        if (!bearerMatches(request.headers.authorization, token)) {
          request.log.warn('An archive came without the shared secret');
          return reply.code(401).send({ error: 'unauthorized' });
        }
        return undefined;
      },
      schema: {
        body: {
          type: 'object',
          required: ['archiveUrl'],
          additionalProperties: false,
          properties: { archiveUrl: { type: ['string', 'null'], maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { archiveUrl } = request.body;
      const url = archiveUrl === null ? undefined : URL.parse(archiveUrl);
      if (
        !UUID.test(id) ||
        (archiveUrl !== null && (url?.protocol !== 'https:' || url.username || url.password))
      ) {
        return reply.code(400).send({ error: 'invalid' });
      }
      try {
        return (await finishArchive(db, id, archiveUrl))
          ? reply.code(204).send()
          : reply.code(404).send({ error: 'notFound' });
      } catch (error) {
        const { code, routine } = (error ?? {}) as { code?: unknown; routine?: unknown };
        const reason =
          typeof code === 'string'
            ? `SQLSTATE ${code} in ${String(routine)}`
            : error instanceof Error
              ? error.name
              : 'unknown';
        request.log.error({ job: id, reason }, 'The archive job failed');
        onFault(new Error(`Archive job failed: ${reason}`));
        return reply.code(500).send({ error: 'internal' });
      }
    },
  );
  app.post<{ Params: { id: string }; Body: IncomingMessage }>(
    '/jobs/:id',
    {
      // Before the body is touched: whoever lacks the secret learns nothing about any job.
      onRequest: async (request, reply) => {
        if (!bearerMatches(request.headers.authorization, token)) {
          request.log.warn('A job came without the shared secret');
          return reply.code(401).send({ error: 'unauthorized' });
        }
        return undefined;
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID.test(id) || typeof request.body?.iterator !== 'function') {
        return reply.code(400).send({ error: 'invalid' });
      }
      if (here.has(id)) {
        return reply.code(409).send({ error: 'busy' });
      }
      const mine = Symbol(id);
      here.set(id, mine);
      const leave = () => {
        if (here.get(id) === mine) {
          here.delete(id);
        }
      };
      // The API gave up while this waited: the job can be asked for again at once.
      let gone = false;
      reply.raw.once('close', () => {
        // Closed before the answer went out: the connection went away.
        if (!reply.raw.writableFinished) {
          gone = true;
          leave();
        }
      });
      try {
        return await queue.run(async () => {
          if (gone || request.raw.destroyed) {
            return reply;
          }
          const source = await jobSource(db, id);
          if (!source) {
            return reply.code(404).send({ error: 'notFound' });
          }
          const bytes = await readCapped(request.body, MAX_COPY_BYTES);
          if (!isCopy(bytes, source.sha256)) {
            return reply.code(422).send({ error: 'mismatch' });
          }
          let result: Extraction | Failed;
          try {
            result = await extractor(source.contentType, bytes);
          } catch (error) {
            // The worker's fault, not the document's: nothing is recorded, and the job can be asked for again.
            const reason = error instanceof Error ? error.name : 'unknown';
            request.log.error({ job: id, reason }, 'Extraction could not run');
            onFault(new Error(`Extraction could not run: ${reason}`));
            return reply.code(503).send({ error: 'unavailable' });
          }
          if (result.status === 'failed') {
            // What the parser choked on is the party's document: never logged, only that it failed.
            request.log.warn({ job: id }, 'The document could not be extracted');
          }
          return (await finishExtraction(db, id, result))
            ? reply.code(204).send()
            : reply.code(404).send({ error: 'notFound' });
        });
      } catch (error) {
        if (error instanceof Refused) {
          return reply.code(error.status).send({ error: error.message });
        }
        // A request gone mid-read is nobody's to answer.
        if (gone) {
          return reply;
        }
        // Not thrown on: the error's message could quote what was being written. Its class (a database error's
        // SQLSTATE and routine) says enough; the job stays open, and the API reports the 500 it gets.
        const { code, routine } = (error ?? {}) as { code?: unknown; routine?: unknown };
        const reason =
          typeof code === 'string'
            ? `SQLSTATE ${code} in ${String(routine)}`
            : error instanceof Error
              ? error.name
              : 'unknown';
        request.log.error({ job: id, reason }, 'The job failed');
        onFault(new Error(`Extraction job failed: ${reason}`));
        return reply.code(500).send({ error: 'internal' });
      } finally {
        leave();
      }
    },
  );
  return app;
};
