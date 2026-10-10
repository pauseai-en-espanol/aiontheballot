import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { BrandImageSource, HomeSource } from './home-data.js';
import type { RoutingSource } from './routing-data.js';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Public routing data, read as aiontheballot_web; without it the route answers 503. */
  routing?: RoutingSource;
  /** A tenant's public home data, read as aiontheballot_web; without it the route answers 503. */
  home?: HomeSource;
  /** A tenant's public brand images; without it the route answers 503. */
  brandImages?: BrandImageSource;
}

export const buildApp = ({
  logger = false,
  routing,
  home,
  brandImages,
}: AppOptions = {}): FastifyInstance => {
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

  // Public data too. Not cached on the way either: the web app caches it and serves its copy if the API fails.
  app.get<{ Params: { slug: string } }>(
    '/public/tenants/:slug/home',
    {
      schema: {
        // The app.slug domain's rule: anything else can't be a tenant.
        params: {
          type: 'object',
          properties: {
            slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 },
          },
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!home) {
        return reply.code(503).send({ error: 'Public data is not configured' });
      }
      const data = await home(request.params.slug);
      if (!data) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return data;
    },
  );

  // A brand image's bytes, by the SHA-256 that the home data names. The web app caches it by that hash.
  app.get<{ Params: { slug: string; sha256: string } }>(
    '/public/tenants/:slug/brand/:sha256',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 },
            sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          },
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!brandImages) {
        return reply.code(503).send({ error: 'Public data is not configured' });
      }
      const image = await brandImages(request.params.slug, request.params.sha256);
      if (!image) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.type(image.contentType).send(Buffer.from(image.content));
    },
  );

  return app;
};
