import type { PublicHome } from '@aiontheballot/domain/public-home';
import type { FastifyInstance } from 'fastify';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
          tenant: { id: 't', slug: 'ejemplo', defaultLocale: 'es', enabledLocales: ['es'] },
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
      tenant: { displayName: { es: 'Ejemplo' }, defaultLocale: 'es', methodologyKind: 'demands' },
      operator: {
        displayName: { es: 'Organización de ejemplo' },
        url: null,
        contactEmail: null,
        newsletterUrl: null,
      },
      election: { name: { es: 'Elecciones de ejemplo' }, date: '2030-01-15' },
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

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
