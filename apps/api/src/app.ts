import { NO_PUBLIC_ELECTION } from '@aiontheballot/domain/public-election';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { ElectionSource } from './election-data.js';
import type { BrandImageSource, HomeSource } from './home-data.js';
import type { RoutingSource } from './routing-data.js';
import type { Signups } from './signups.js';

import { adminRoutes, type AdminRoutesOptions } from './auth/routes.js';
import { createRateLimiter, visitorKey } from './rate-limit.js';

export interface AppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Public routing data, read as aiontheballot_web; without it the route answers 503. */
  routing?: RoutingSource;
  /** A tenant's public home data, read as aiontheballot_web; without it the route answers 503. */
  home?: HomeSource;
  /** A tenant's public brand images; without it the route answers 503. */
  brandImages?: BrandImageSource;
  /** A tenant's public elections, read as aiontheballot_web; without it the route answers 503. */
  elections?: ElectionSource;
  /** The signup list's public actions (PLAN R119); without mail they answer 503. */
  signups?: Signups;
  /** Signups a visitor may send per 10 minutes, per API replica, before 429 (the database caps each site too). */
  signupsPerVisitor?: number;
  /** Sign-in and the signed-in routes under /api, on the admin host only; without sign-in they answer 503. */
  admin?: AdminRoutesOptions;
}

const SLUG_PARAMS = {
  type: 'object',
  properties: { slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 } },
} as const;

const TOKEN_BODY = {
  type: 'object',
  required: ['token'],
  additionalProperties: false,
  properties: { token: { type: 'string', maxLength: 64 } },
} as const;

/**
 * The visitor's address, as the web app passes it (the last `X-Forwarded-For` entry, the gateway's), only to count
 * their requests. These routes are reached only from inside the cluster, by the web app.
 */
const visitorOf = (header: string | string[] | undefined): string =>
  typeof header === 'string' ? visitorKey(header) : 'unknown';

export const buildApp = ({
  logger = false,
  routing,
  home,
  brandImages,
  elections,
  signups,
  signupsPerVisitor = 5,
  admin = {},
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
      // The app.slug domain's rule: anything else can't be a tenant.
      schema: { params: SLUG_PARAMS },
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

  // A public election: the scorecard's and its pages' data (public-site spec §5). Not cached on the way either: the web
  // app caches it and serves its copy if the API fails.
  app.get<{ Params: { slug: string; election: string } }>(
    '/public/tenants/:slug/elections/:election',
    {
      schema: {
        params: {
          type: 'object',
          properties: { slug: SLUG_PARAMS.properties.slug, election: SLUG_PARAMS.properties.slug },
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!elections) {
        return reply.code(503).send({ error: 'Public data is not configured' });
      }
      const data = await elections(request.params.slug, request.params.election);
      if (!data) {
        return reply.code(404).send({ error: NO_PUBLIC_ELECTION });
      }
      return data;
    },
  );

  // The signup list (PLAN R119; public-site spec §6), through the web app's form. The answer is the same whatever was
  // done, so whether an address is on a list never leaks; only the web app sees it, and it says only "check your email".
  const allowSignup = createRateLimiter({ limit: signupsPerVisitor, windowMs: 10 * 60_000 });
  app.post<{
    Params: { slug: string };
    Body: { email: string; locale: string; futureElections?: boolean };
  }>(
    '/public/tenants/:slug/signups',
    {
      schema: {
        params: SLUG_PARAMS,
        body: {
          type: 'object',
          required: ['email', 'locale'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', maxLength: 320 },
            locale: { type: 'string', maxLength: 10 },
            futureElections: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!signups) {
        return reply.code(503).send({ error: 'unavailable' });
      }
      if (!allowSignup(visitorOf(request.headers['x-visitor-address']))) {
        return reply.code(429).send({ error: 'limit' });
      }
      const { email, locale, futureElections = false } = request.body;
      const outcome = await signups.signUp(request.params.slug, { email, locale, futureElections });
      const status = {
        accepted: 202,
        'not-found': 404,
        unavailable: 409,
        invalid: 400,
        limit: 429,
      }[outcome];
      return reply.code(status).send({ outcome });
    },
  );

  // A token acts only on its own site's list (the site the link's page is on).
  app.post<{ Params: { slug: string }; Body: { token: string } }>(
    '/public/tenants/:slug/signups/confirm',
    { schema: { params: SLUG_PARAMS, body: TOKEN_BODY } },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!signups) {
        return reply.code(503).send({ error: 'unavailable' });
      }
      return { confirmed: await signups.confirm(request.params.slug, request.body.token) };
    },
  );

  app.post<{ Params: { slug: string }; Body: { token: string } }>(
    '/public/tenants/:slug/signups/unsubscribe',
    { schema: { params: SLUG_PARAMS, body: TOKEN_BODY } },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!signups) {
        return reply.code(503).send({ error: 'unavailable' });
      }
      return { unsubscribed: await signups.unsubscribe(request.params.slug, request.body.token) };
    },
  );

  void app.register(adminRoutes(admin), { prefix: '/api' });

  return app;
};
