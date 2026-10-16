import type { FastifyInstance } from 'fastify';

/**
 * For routes that take large bodies as streams (an upload, a copy for the worker) and may refuse before or while
 * reading them. Node then either reads the rest of an unread body to its end, however long it is, or, once a reader
 * stopped, waits for it as long as the client likes. Instead, after a refusal (any answer of 300 or more sent while the
 * body is unfinished), what is still coming is read and dropped up to `maxBytes`, then left unread, and the connection
 * is closed `maxMs` after the answer went out: time for the client to read the answer rather than a reset. A client
 * that finishes sending within those limits keeps its connection.
 */
export const limitUnreadBodies = (
  scope: FastifyInstance,
  { maxBytes = 1024 * 1024, maxMs = 5_000 }: { maxBytes?: number; maxMs?: number } = {},
): void => {
  scope.addHook('onSend', async (request, reply) => {
    const raw = request.raw;
    if (reply.statusCode < 300 || raw.complete || raw.destroyed) {
      return;
    }
    let dropped = 0;
    let timer: NodeJS.Timeout | undefined;
    raw.on('data', (chunk: Buffer) => {
      dropped += chunk.byteLength;
      if (dropped > maxBytes) {
        raw.pause();
      }
    });
    raw.once('end', () => clearTimeout(timer));
    raw.once('close', () => clearTimeout(timer));
    reply.raw.once('finish', () => {
      if (!raw.complete) {
        // The request's destroy closes its connection.
        timer = setTimeout(() => raw.destroy(), maxMs);
      }
    });
    raw.resume();
  });
};
