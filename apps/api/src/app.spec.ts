import type { PublicHome } from '@aiontheballot/domain/public-home';
import type { FastifyInstance } from 'fastify';

import { NO_PUBLIC_ELECTION, type PublicElection } from '@aiontheballot/domain/public-election';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SignupInput, SignupOutcome, Signups } from './signups.js';

import { buildApp } from './app.js';

describe('api', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the liveness probe without touching dependencies', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('answers 503 for routing data while no public database is configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/public/routing' });
    expect(response.statusCode).toBe(503);
  });

  it('serves the routing data, never to be cached on the way', async () => {
    const data = {
      tenants: [
        {
          tenant: {
            id: 't',
            slug: 'ejemplo',
            defaultLocale: 'es',
            enabledLocales: ['es'],
            open: false,
            indexed: true,
            plausibleScript: null,
          },
          hostnames: [{ hostname: 'ejemplo.example.test', isCanonical: true, verified: true }],
        },
      ],
    };
    const routed = buildApp({ routing: async () => data });
    const response = await routed.inject({ method: 'GET', url: '/public/routing' });
    await routed.close();
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(data);
  });

  describe("a tenant's home data", () => {
    const data: PublicHome = {
      tenant: {
        displayName: { es: 'Ejemplo' },
        defaultLocale: 'es',
        countryCode: 'XA',
        methodologyKind: 'demands',
      },
      operator: {
        displayName: { es: 'Organización de ejemplo' },
        url: null,
        contactEmail: null,
        newsletterUrl: null,
        legalName: 'Organización de Ejemplo',
        taxId: null,
        address: null,
        registryEntry: null,
        privacyEmail: null,
      },
      election: { name: { es: 'Elecciones de ejemplo' }, date: '2030-01-15' },
      brand: {},
      documents: {},
      elections: [],
      signups: false,
    };
    const withHome = () =>
      buildApp({ home: async (slug) => (slug === 'ejemplo' ? data : undefined) });

    it('answers 503 while no public database is configured', async () => {
      const response = await app.inject({ method: 'GET', url: '/public/tenants/ejemplo/home' });
      expect(response.statusCode).toBe(503);
    });

    it('serves it, never to be cached on the way', async () => {
      const homed = withHome();
      const response = await homed.inject({ method: 'GET', url: '/public/tenants/ejemplo/home' });
      await homed.close();
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual(data);
    });

    it('answers 404 for a slug no active tenant has', async () => {
      const homed = withHome();
      const response = await homed.inject({ method: 'GET', url: '/public/tenants/otro/home' });
      await homed.close();
      expect(response.statusCode).toBe(404);
    });

    it('refuses a slug that no tenant could have, before reading anything', async () => {
      let asked = false;
      const homed = buildApp({
        home: async () => {
          asked = true;
          return data;
        },
      });
      const response = await homed.inject({
        method: 'GET',
        url: `/public/tenants/${encodeURIComponent("Ejemplo'; --")}/home`,
      });
      await homed.close();
      expect(response.statusCode).toBe(400);
      expect(asked).toBe(false);
    });
  });

  describe("a tenant's brand images", () => {
    const sha = 'a'.repeat(64);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const withImages = () =>
      buildApp({
        brandImages: async (slug, sha256) =>
          slug === 'ejemplo' && sha256 === sha
            ? { contentType: 'image/png', content: png }
            : undefined,
      });

    it('answers 503 while no public database is configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/public/tenants/ejemplo/brand/${sha}`,
      });
      expect(response.statusCode).toBe(503);
    });

    it('serves the bytes with their type, never to be cached on the way', async () => {
      const served = withImages();
      const response = await served.inject({
        method: 'GET',
        url: `/public/tenants/ejemplo/brand/${sha}`,
      });
      await served.close();
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(new Uint8Array(response.rawPayload)).toEqual(png);
    });

    it('answers 404 for an image the tenant does not show, and 400 for a malformed hash', async () => {
      const served = withImages();
      const unknown = await served.inject({
        method: 'GET',
        url: `/public/tenants/ejemplo/brand/${'b'.repeat(64)}`,
      });
      const malformed = await served.inject({
        method: 'GET',
        url: '/public/tenants/ejemplo/brand/../x',
      });
      await served.close();
      expect(unknown.statusCode).toBe(404);
      expect([400, 404]).toContain(malformed.statusCode);
    });
  });

  describe("a tenant's public election", () => {
    const data: PublicElection = {
      election: {
        slug: 'generales',
        name: { es: 'Generales de ejemplo' },
        date: null,
        status: 'live',
      },
      methodology: null,
      parties: [],
      criteria: [],
      cells: [],
    };
    const withElections = () =>
      buildApp({
        elections: async (slug, election) =>
          slug === 'ejemplo' && election === 'generales' ? data : undefined,
      });

    it('answers 503 while no public database is configured', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/public/tenants/ejemplo/elections/generales',
      });
      expect(response.statusCode).toBe(503);
    });

    it('serves it, never cached on the way, and 404 or 400 for anything else', async () => {
      const served = withElections();
      const found = await served.inject({
        method: 'GET',
        url: '/public/tenants/ejemplo/elections/generales',
      });
      const missing = await served.inject({
        method: 'GET',
        url: '/public/tenants/ejemplo/elections/otras',
      });
      const malformed = await served.inject({
        method: 'GET',
        url: '/public/tenants/ejemplo/elections/Otras_',
      });
      await served.close();
      expect(found.statusCode).toBe(200);
      expect(found.headers['cache-control']).toBe('no-store');
      expect(found.json()).toEqual(data);
      expect(missing.statusCode).toBe(404);
      // What tells the web app that no public election has the slugs, not that the route is missing.
      expect(missing.json()).toEqual({ error: NO_PUBLIC_ELECTION });
      expect(malformed.statusCode).toBe(400);
    });
  });

  describe('the signup list', () => {
    const calls: { slug: string; input: SignupInput }[] = [];
    const signups = (outcome: SignupOutcome): Signups => ({
      signUp: async (slug, input) => {
        calls.push({ slug, input });
        return outcome;
      },
      confirm: async (slug, token) => slug === 'ejemplo' && token === 'bueno',
      unsubscribe: async (slug, token) => slug === 'ejemplo' && token === 'bueno',
      deleteExpired: async () => undefined,
      settle: async () => undefined,
    });
    const post = (
      target: FastifyInstance,
      url: string,
      payload: unknown,
      visitor = '203.0.113.7',
    ) =>
      target.inject({
        method: 'POST',
        url,
        payload: payload as object,
        headers: { 'x-visitor-address': visitor },
      });
    const body = { email: 'persona@example.org', locale: 'es', futureElections: true };

    it('answers 503 while the API cannot send mail', async () => {
      for (const url of [
        '/public/tenants/ejemplo/signups',
        '/public/tenants/ejemplo/signups/confirm',
        '/public/tenants/ejemplo/signups/unsubscribe',
      ]) {
        const response = await post(app, url, url.endsWith('signups') ? body : { token: 'x' });
        expect(response.statusCode, url).toBe(503);
      }
    });

    it.each<[SignupOutcome, number]>([
      ['accepted', 202],
      ['not-found', 404],
      ['unavailable', 409],
      ['invalid', 400],
      ['limit', 429],
    ])('answers %s with %i, never cached', async (outcome, status) => {
      const listed = buildApp({ signups: signups(outcome) });
      const response = await post(listed, '/public/tenants/ejemplo/signups', body);
      await listed.close();
      expect(response.statusCode).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ outcome });
    });

    it('passes the form on, the box unticked unless sent', async () => {
      calls.length = 0;
      const listed = buildApp({ signups: signups('accepted') });
      await post(listed, '/public/tenants/ejemplo/signups', {
        email: 'a@example.org',
        locale: 'es',
      });
      await listed.close();
      expect(calls).toEqual([
        {
          slug: 'ejemplo',
          input: { email: 'a@example.org', locale: 'es', futureElections: false },
        },
      ]);
    });

    it('passes on nothing else the body holds, and refuses a malformed slug or address', async () => {
      calls.length = 0;
      const listed = buildApp({ signups: signups('accepted') });
      await post(listed, '/public/tenants/ejemplo/signups', { ...body, consent: 'yes' });
      const slug = await post(listed, '/public/tenants/No_Valido/signups', body);
      const long = await post(listed, '/public/tenants/ejemplo/signups', {
        ...body,
        email: 'a'.repeat(321),
      });
      await listed.close();
      expect(calls.map((call) => Object.keys(call.input).sort())).toEqual([
        ['email', 'futureElections', 'locale'],
      ]);
      expect(slug.statusCode).toBe(400);
      expect(long.statusCode).toBe(400);
    });

    it('counts each visitor apart, and refuses one past the limit', async () => {
      const listed = buildApp({ signups: signups('accepted'), signupsPerVisitor: 2 });
      const statuses = [];
      for (const visitor of ['203.0.113.7', '203.0.113.7', '203.0.113.7', '198.51.100.2']) {
        statuses.push(
          (await post(listed, '/public/tenants/ejemplo/signups', body, visitor)).statusCode,
        );
      }
      await listed.close();
      expect(statuses).toEqual([202, 202, 429, 202]);
    });

    it("confirms and unsubscribes by token, on the token's own site only", async () => {
      const listed = buildApp({ signups: signups('accepted') });
      const site = '/public/tenants/ejemplo/signups';
      const confirmed = await post(listed, `${site}/confirm`, { token: 'bueno' });
      const elsewhere = await post(listed, '/public/tenants/otro/signups/confirm', {
        token: 'bueno',
      });
      const unknown = await post(listed, `${site}/unsubscribe`, { token: 'otro' });
      const malformed = await post(listed, `${site}/confirm`, { token: 'x'.repeat(65) });
      await listed.close();
      expect(confirmed.json()).toEqual({ confirmed: true });
      expect(elsewhere.json()).toEqual({ confirmed: false });
      expect(unknown.json()).toEqual({ unsubscribed: false });
      expect(malformed.statusCode).toBe(400);
    });
  });

  describe('the right-of-reply form (R149)', () => {
    const report = {
      kind: 'error_report',
      message: 'Un mensaje inventado.',
      election: 'generales',
      party: 'partido-a',
      criterion: 'criterio-1',
    };
    const post = (target: FastifyInstance, payload: unknown, visitor = '203.0.113.8') =>
      target.inject({
        method: 'POST',
        url: '/public/tenants/ejemplo/reports',
        payload: payload as object,
        headers: { 'x-visitor-address': visitor },
      });

    it('answers 503 while no public database is configured', async () => {
      const bare = buildApp();
      expect((await post(bare, report)).statusCode).toBe(503);
      await bare.close();
    });

    it('passes the form on, and says how it went in a status the web app reads', async () => {
      const seen: unknown[] = [];
      for (const [outcome, status] of [
        ['accepted', 202],
        ['not-found', 404],
        ['invalid', 400],
        ['links', 400],
        ['limit', 429],
      ] as const) {
        const target = buildApp({
          reports: async (slug, input) => {
            seen.push({ slug, input });
            return outcome;
          },
        });
        const response = await post(target, report);
        await target.close();
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({ outcome });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      expect(seen[0]).toEqual({ slug: 'ejemplo', input: report });
    });

    it('takes a few reports per visitor, then 429 for that visitor only', async () => {
      const target = buildApp({ reports: async () => 'accepted', reportsPerVisitor: 2 });
      const statuses = [];
      for (const visitor of ['203.0.113.9', '203.0.113.9', '203.0.113.9', '203.0.113.10']) {
        statuses.push((await post(target, report, visitor)).statusCode);
      }
      await target.close();
      expect(statuses).toEqual([202, 202, 429, 202]);
    });

    it('takes a few a day per visitor too, counting an IPv6 network by its /48', async () => {
      const target = buildApp({
        reports: async () => 'accepted',
        reportsPerVisitor: 100,
        reportsPerVisitorPerDay: 2,
      });
      const statuses = [];
      // Three addresses of one /48: one visitor.
      for (const visitor of [
        '2001:db8:1:1::1',
        '2001:db8:1:2::1',
        '2001:db8:1:ffff::9',
        '2001:db8:2::1',
      ]) {
        statuses.push((await post(target, report, visitor)).statusCode);
      }
      await target.close();
      expect(statuses).toEqual([202, 202, 429, 202]);
    });

    it("answers a fault without the database's words, which can quote the report", async () => {
      const failing = buildApp({
        reports: async () => {
          throw Object.assign(new Error('null value violates not-null constraint'), {
            code: '23502',
            routine: 'ExecConstraints',
            detail:
              'Failing row contains (Persona de Ejemplo, persona@ejemplo.test, Un mensaje inventado).',
          });
        },
      });
      const response = await post(failing, report);
      await failing.close();
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ outcome: 'failed' });
      expect(response.body).not.toMatch(/Persona|mensaje|Failing/);
    });

    it('refuses what no form sends, before the database hears of it', async () => {
      const target = buildApp({ reports: async () => 'accepted' });
      for (const payload of [
        { ...report, kind: 'otra' },
        { ...report, election: '../otra' },
        { ...report, message: 'x'.repeat(10_001) },
        { kind: 'error_report', election: 'generales' },
      ]) {
        expect((await post(target, payload)).statusCode, JSON.stringify(payload)).toBe(400);
      }
      await target.close();
      // A field no form has is dropped (Fastify's schema), never passed on.
      const seen: unknown[] = [];
      const dropping = buildApp({
        reports: async (_slug, input) => {
          seen.push(input);
          return 'accepted';
        },
      });
      await post(dropping, { ...report, status: 'accepted' });
      await dropping.close();
      expect(seen).toEqual([report]);
    });
  });

  describe("the admin's preview of a site (PLAN R181)", () => {
    const token = 'un-secreto-de-vista-previa-de-mas-de-32-caracteres';
    const home = { elections: [] } as unknown as PublicHome;
    const election = { election: { slug: 'consulta' } } as unknown as PublicElection;
    const sha = 'b'.repeat(64);
    const urls = [
      '/preview/tenants/ejemplo/home',
      '/preview/tenants/ejemplo/elections/consulta',
      `/preview/tenants/ejemplo/brand/${sha}`,
    ];
    const previewed = (asked: string[] = []) =>
      buildApp({
        preview: {
          token,
          home: async (slug) => {
            asked.push(`home ${slug}`);
            return home;
          },
          elections: async (slug, slugOfElection) => {
            asked.push(`election ${slug}/${slugOfElection}`);
            return election;
          },
          brandImages: async (slug, sha256) => {
            asked.push(`brand ${slug}/${sha256}`);
            return { contentType: 'image/png', content: new Uint8Array([1]) };
          },
        },
      });

    it('answers 503 while the preview is not configured', async () => {
      for (const url of urls) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: { 'x-aiontheballot-preview-token': token },
        });
        expect(response.statusCode).toBe(503);
      }
    });

    it('answers 404 without the secret, or with another, and reads nothing', async () => {
      const asked: string[] = [];
      const api = previewed(asked);
      for (const url of urls) {
        for (const headers of [
          {},
          { 'x-aiontheballot-preview-token': '' },
          { 'x-aiontheballot-preview-token': `${token}x` },
          { 'x-aiontheballot-preview-token': token.toUpperCase() },
          { authorization: `Bearer ${token}` },
        ]) {
          const response = await api.inject({ method: 'GET', url, headers });
          expect(response.statusCode).toBe(404);
          expect(response.headers['cache-control']).toBe('no-store');
        }
      }
      await api.close();
      expect(asked).toEqual([]);
    });

    it("serves the preview's data with the secret, never to be cached on the way", async () => {
      const asked: string[] = [];
      const api = previewed(asked);
      const answers = [];
      for (const url of urls) {
        answers.push(
          await api.inject({
            method: 'GET',
            url,
            headers: { 'x-aiontheballot-preview-token': token },
          }),
        );
      }
      await api.close();
      expect(answers.map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(answers.every((response) => response.headers['cache-control'] === 'no-store')).toBe(
        true,
      );
      expect(answers[0]!.json()).toEqual(home);
      expect(answers[1]!.json()).toEqual(election);
      expect(answers[2]!.headers['content-type']).toBe('image/png');
      expect(asked).toEqual(['home ejemplo', 'election ejemplo/consulta', `brand ejemplo/${sha}`]);
    });

    it("never serves the preview's data on the public routes, secret or not", async () => {
      const asked: string[] = [];
      const api = previewed(asked);
      for (const url of urls.map((path) => path.replace('/preview/', '/public/'))) {
        const response = await api.inject({
          method: 'GET',
          url,
          headers: { 'x-aiontheballot-preview-token': token },
        });
        expect(response.statusCode).toBe(503);
      }
      await api.close();
      expect(asked).toEqual([]);
    });
  });

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });

  // Fastify's own handler would send the fault's message, which can name an address or quote a query (PLAN R208).
  it('answers a fault as unexpected, never with its message', async () => {
    const failing = buildApp({
      routing: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:5432'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    const response = await failing.inject({ method: 'GET', url: '/public/routing' });
    await failing.close();
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'unexpected' });
  });

  it('answers anything thrown as unexpected, an error or not', async () => {
    for (const thrown of [null, undefined, 'plain text']) {
      const failing = buildApp({
        routing: async () => {
          throw thrown;
        },
      });
      const response = await failing.inject({ method: 'GET', url: '/public/routing' });
      await failing.close();
      expect(response.statusCode, String(thrown)).toBe(500);
      expect(response.json(), String(thrown)).toEqual({ error: 'unexpected' });
    }
  });

  it('keeps a refusal its status, whether the error or the reply carries it', async () => {
    const refusing = buildApp({
      routing: async () => {
        throw Object.assign(new Error('Not yours'), { status: 403 });
      },
      home: async () => {
        throw new Error('After a 404');
      },
    });
    refusing.addHook('preHandler', async (request, reply) => {
      if (request.url.endsWith('/home')) {
        void reply.code(404);
      }
    });
    const byError = await refusing.inject({ method: 'GET', url: '/public/routing' });
    const byReply = await refusing.inject({ method: 'GET', url: '/public/tenants/ejemplo/home' });
    await refusing.close();
    expect(byError.statusCode).toBe(403);
    expect(byReply.statusCode).toBe(404);
  });

  it("keeps Fastify's answer to a request it refuses", async () => {
    const response = await app.inject({ method: 'GET', url: '/public/tenants/Not_A_Slug/home' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'FST_ERR_VALIDATION' });
  });
});
