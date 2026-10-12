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

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
