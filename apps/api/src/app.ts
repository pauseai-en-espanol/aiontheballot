import { NO_PUBLIC_ELECTION } from '@aiontheballot/domain/public-election';
import { captureException } from '@sentry/node';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import type { ElectionSource } from './election-data.js';
import type { BrandImageSource, HomeSource } from './home-data.js';
import type { ReportInput, ReportOutcome } from './reports.js';
import type { RoutingSource } from './routing-data.js';
import type { Signups } from './signups.js';

import { adminRoutes, type AdminRoutesOptions } from './auth/routes.js';
import { createRateLimiter, visitorKey } from './rate-limit.js';
import { headerMatches } from './worker/token.js';

/** The header the web app sends the preview's secret in, as the admin sends it to the web app (ADR-0005). */
export const PREVIEW_TOKEN_HEADER = 'x-aiontheballot-preview-token';

/**
 * The admin's preview of a site (PLAN R181; ADR-0005): its data as aiontheballot_preview reads it, which also sees
 * elections in preview, for the web app's preview host only, which sends the secret it shares with the admin.
 */
export interface PreviewOptions {
  token: string;
  home: HomeSource;
  elections: ElectionSource;
  /** Without the file store, its images answer 503, as the public ones. */
  brandImages?: BrandImageSource | undefined;
}

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
  /** The same three, for the admin's preview (PLAN R181); without it the preview's routes answer 503. */
  preview?: PreviewOptions | undefined;
  /** The signup list's public actions (PLAN R119); without mail they answer 503. */
  signups?: Signups;
  /** Signups a visitor may send per 10 minutes, per API replica, before 429 (the database caps each site too). */
  signupsPerVisitor?: number;
  /** The right-of-reply form's intake (PLAN R149), as aiontheballot_web; without it the route answers 503. */
  reports?: (slug: string, input: ReportInput) => Promise<ReportOutcome>;
  /** Reports a visitor may send per 10 minutes, per API replica, before 429 (the database caps each site too). */
  reportsPerVisitor?: number;
  /** And per day, per API replica. */
  reportsPerVisitorPerDay?: number;
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
  preview,
  signups,
  signupsPerVisitor = 5,
  reports,
  reportsPerVisitor = 3,
  reportsPerVisitorPerDay = 10,
  admin = {},
}: AppOptions = {}): FastifyInstance => {
  const app = Fastify({
    logger,
    // Longer than the Envoy Gateway idle timeout (60s), so the gateway closes idle connections first.
    keepAliveTimeout: 75_000,
    // A whole request, body included, within 15 minutes: a 50 MB copy on a slow connection fits, and a client that
    // stops sending halfway doesn't keep its connection for ever.
    requestTimeout: 15 * 60_000,
  });

  // A fault never reaches the client as its message, which Fastify's own handler would send: a connection error names
  // an address, a query's error can quote what was written (PLAN R208). A refusal (4xx, by the error's status or the
  // reply's: a schema, a content type, a body too large) keeps Fastify's answer; anything else is logged and reported
  // as signedIn reports a fault, an error with a code (SQLSTATE, or Node's) by that code and where it came from, never
  // its message. The only report: the API server turns off Sentry's own (API_TRACKING).
  app.setErrorHandler(async (error, request, reply) => {
    const { statusCode, status, code, routine } = (error ?? {}) as {
      statusCode?: unknown;
      status?: unknown;
      code?: unknown;
      routine?: unknown;
    };
    const declared =
      typeof statusCode === 'number'
        ? statusCode
        : typeof status === 'number'
          ? status
          : reply.statusCode;
    if (declared >= 400 && declared < 500) {
      throw error;
    }
    if (typeof code === 'string') {
      const where = typeof routine === 'string' ? ` in ${routine}` : '';
      request.log.error({ code, routine }, 'Request failed');
      captureException(new Error(`Request failed: ${code}${where}`));
    } else {
      request.log.error({ err: error }, 'Request failed');
      captureException(error);
    }
    return reply.code(500).send({ error: 'unexpected' });
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

  /**
   * A site's data, under `prefix`: the public's (`/public`), or the preview's (`/preview`). Not cached on the way: the
   * web app keeps the public data and serves its copy if the API fails. `allowed` decides first whether the request
   * may have it at all; the 404 it answers otherwise says nothing more.
   */
  const siteData = (
    prefix: string,
    sources: {
      home?: HomeSource | undefined;
      brandImages?: BrandImageSource | undefined;
      elections?: ElectionSource | undefined;
    },
    allowed: (headers: Record<string, string | string[] | undefined>) => boolean,
  ): void => {
    app.get<{ Params: { slug: string } }>(
      `${prefix}/tenants/:slug/home`,
      {
        // The app.slug domain's rule: anything else can't be a tenant.
        schema: { params: SLUG_PARAMS },
      },
      async (request, reply) => {
        void reply.header('cache-control', 'no-store');
        if (!sources.home) {
          return reply.code(503).send({ error: 'Public data is not configured' });
        }
        if (!allowed(request.headers)) {
          return reply.code(404).send({ error: 'Not found' });
        }
        const data = await sources.home(request.params.slug);
        if (!data) {
          return reply.code(404).send({ error: 'Not found' });
        }
        return data;
      },
    );

    // A brand image's bytes, by the SHA-256 that the home data names. The web app caches it by that hash.
    app.get<{ Params: { slug: string; sha256: string } }>(
      `${prefix}/tenants/:slug/brand/:sha256`,
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
        if (!sources.brandImages) {
          return reply.code(503).send({ error: 'Public data is not configured' });
        }
        if (!allowed(request.headers)) {
          return reply.code(404).send({ error: 'Not found' });
        }
        const image = await sources.brandImages(request.params.slug, request.params.sha256);
        if (!image) {
          return reply.code(404).send({ error: 'Not found' });
        }
        return reply.type(image.contentType).send(Buffer.from(image.content));
      },
    );

    // An election: the scorecard's and its pages' data (public-site spec §5).
    app.get<{ Params: { slug: string; election: string } }>(
      `${prefix}/tenants/:slug/elections/:election`,
      {
        schema: {
          params: {
            type: 'object',
            properties: {
              slug: SLUG_PARAMS.properties.slug,
              election: SLUG_PARAMS.properties.slug,
            },
          },
        },
      },
      async (request, reply) => {
        void reply.header('cache-control', 'no-store');
        if (!sources.elections) {
          return reply.code(503).send({ error: 'Public data is not configured' });
        }
        if (!allowed(request.headers)) {
          return reply.code(404).send({ error: 'Not found' });
        }
        const data = await sources.elections(request.params.slug, request.params.election);
        if (!data) {
          return reply.code(404).send({ error: NO_PUBLIC_ELECTION });
        }
        return data;
      },
    );
  };

  // Public data, as aiontheballot_web reads it.
  siteData('/public', { home, brandImages, elections }, () => true);
  // The admin's preview (PLAN R181): as aiontheballot_preview reads it, only with the secret the web app's preview host
  // sends. These routes are reached only from inside the cluster, by the web app, like the public ones.
  siteData(
    '/preview',
    { home: preview?.home, brandImages: preview?.brandImages, elections: preview?.elections },
    (headers) =>
      preview !== undefined && headerMatches(headers[PREVIEW_TOKEN_HEADER], preview.token),
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

  // The right-of-reply form (BRIEF §4; PLAN R149), through the web app's form, which has done its spam checks. A few
  // reports per visitor and 10 minutes, and per day, so one sender can't spend a site's daily cap (the database's)
  // alone; IPv6 visitors count by /48, what one network is commonly given.
  const allowReport = createRateLimiter({ limit: reportsPerVisitor, windowMs: 10 * 60_000 });
  const allowReportToday = createRateLimiter({
    limit: reportsPerVisitorPerDay,
    windowMs: 24 * 60 * 60_000,
  });
  const short = { type: 'string', maxLength: 400 } as const;
  const slug = { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 } as const;
  app.post<{ Params: { slug: string }; Body: ReportInput }>(
    '/public/tenants/:slug/reports',
    {
      schema: {
        params: SLUG_PARAMS,
        body: {
          type: 'object',
          required: ['kind', 'message', 'election'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['error_report', 'party_response'] },
            message: { type: 'string', maxLength: 10_000 },
            election: slug,
            party: slug,
            criterion: slug,
            name: short,
            email: short,
            organization: short,
            partyRepresentative: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (!reports) {
        return reply.code(503).send({ error: 'unavailable' });
      }
      const header = request.headers['x-visitor-address'];
      const visitor =
        typeof header === 'string' ? visitorKey(header, { ipv6Prefix: 48 }) : 'unknown';
      // Both windows count every try, so a sender at either limit stays there.
      const withinWindow = allowReport(visitor);
      if (!allowReportToday(visitor) || !withinWindow) {
        return reply.code(429).send({ outcome: 'limit' });
      }
      let outcome: ReportOutcome;
      try {
        outcome = await reports(request.params.slug, request.body);
      } catch (error) {
        // Never the database's message or detail, which can quote the report ("Failing row contains …"): its class.
        const { code, routine } = (error ?? {}) as { code?: unknown; routine?: unknown };
        const reason =
          typeof code === 'string' ? `SQLSTATE ${code} in ${String(routine)}` : 'unknown';
        request.log.error({ reason }, 'A report could not be taken');
        captureException(new Error(`A report could not be taken: ${reason}`));
        return reply.code(500).send({ outcome: 'failed' });
      }
      const status = { accepted: 202, 'not-found': 404, invalid: 400, links: 400, limit: 429 }[
        outcome
      ];
      return reply.code(status).send({ outcome });
    },
  );

  void app.register(adminRoutes(admin), { prefix: '/api' });

  return app;
};
