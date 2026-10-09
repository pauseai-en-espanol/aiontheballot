import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { RoutingSource } from './routing-data.js';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Public routing data, read as aiontheballot_web; without it the route answers 503. */
  routing?: RoutingSource;
}

export const buildApp = ({ logger = false, routing }: AppOptions = {}): FastifyInstance => {
  const app = Fastify({
    logger,
    // Longer than the Envoy Gateway idle timeout (60s), so the gateway closes idle connections first.
    keepAliveTimeout: 75_000,
  });

  // Liveness only: deliberately no database or downstream checks, so a slow dependency never restarts the pod.
  // Not logged: probes run every few seconds.
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  // What the public web app routes by: public data only. Never cached on the way: the web app keeps its own copy.
  app.get('/public/routing', async (_request, reply) => {
    void reply.header('cache-control', 'no-store');
    if (!routing) {
      return reply.code(503).send({ error: 'Routing data is not configured' });
    }
    return routing();
  });

  return app;
};
