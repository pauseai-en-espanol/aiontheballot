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

  it('returns 404 for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
  });
});
