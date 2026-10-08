import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
}

export const buildApp = ({ logger = false }: AppOptions = {}): FastifyInstance => {
  const app = Fastify({
    logger,
    // Longer than the Envoy Gateway idle timeout (60s), so the gateway closes idle connections first.
    keepAliveTimeout: 75_000,
  });

  // Liveness only: deliberately no database or downstream checks, so a slow dependency never restarts the pod.
  // Not logged: probes run every few seconds.
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  return app;
};
