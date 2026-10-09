import { expect, test } from '@playwright/test';
import { request as httpRequest } from 'node:http';

import { API_URL, PLATFORM_HOST, PORTS, SEED_HOSTS } from '../servers.js';

interface Answer {
  status: number;
  location: string | undefined;
  setCookie: string[] | undefined;
}

/**
 * Sends a raw request to the web server with any Host header (browsers and fetch can't), the way the gateway forwards
 * it (ADR-0002, routing tests).
 */
const ask = (host: string, path: string, headers: Record<string, string> = {}): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: PORTS.web, path, method: 'GET', headers: { host, ...headers } },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location,
            setCookie: res.headers['set-cookie'],
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });

const port = `:${PORTS.web}`;

test.describe('public routing (ADR-0002), against the fictional seeds', () => {
  test('serves a tenant on its canonical hostname, port or not', async () => {
    for (const host of [
      SEED_HOSTS.canonical,
      `${SEED_HOSTS.canonical}${port}`,
      'EJEMPLO-A.localhost.',
    ]) {
      expect((await ask(host, '/')).status, host).toBe(200);
    }
  });

  test('redirects a verified alias to the canonical address, keeping the path and query', async () => {
    const answer = await ask(SEED_HOSTS.alias, '/partidos?orden=1');
    expect(answer.status).toBe(301);
    expect(answer.location).toBe(`https://${SEED_HOSTS.canonical}/partidos?orden=1`);
  });

  test('serves a tenant without a hostname by path on the platform host, and redirects one that has one', async () => {
    expect((await ask(PLATFORM_HOST, '/ejemplo-b')).status).toBe(200);
    expect((await ask(PLATFORM_HOST, '/ejemplo-b/en')).status).toBe(200);
    const answer = await ask(PLATFORM_HOST, '/ejemplo-a/partidos');
    expect(answer.status).toBe(301);
    expect(answer.location).toBe(`https://${SEED_HOSTS.canonical}/partidos`);
  });

  test('answers 404 to unknown, unverified and inactive hosts, and unknown slugs', async () => {
    for (const [host, path] of [
      ['desconocido.localhost', '/'],
      [SEED_HOSTS.unverified, '/'],
      [SEED_HOSTS.inactive, '/'],
      [PLATFORM_HOST, '/no-existe'],
      [PLATFORM_HOST, '/ejemplo-inactivo'],
    ] as const) {
      expect((await ask(host, path)).status, `${host}${path}`).toBe(404);
    }
  });

  test('ignores a spoofed X-Forwarded-Host', async () => {
    expect(
      (await ask('desconocido.localhost', '/', { 'x-forwarded-host': SEED_HOSTS.canonical }))
        .status,
    ).toBe(404);
    expect(
      (await ask(SEED_HOSTS.canonical, '/', { 'x-forwarded-host': 'desconocido.localhost' }))
        .status,
    ).toBe(200);
  });

  test('answers 404 to the internal path prefix, encoded or not', async () => {
    for (const path of [
      '/_tenant/ejemplo-a/es',
      '/%5Ftenant/ejemplo-a/es',
      '/%5ftenant/ejemplo-a/es',
    ]) {
      expect((await ask(SEED_HOSTS.canonical, path)).status, path).toBe(404);
    }
  });

  test('answers the health probe on any host, such as the pod IP', async () => {
    expect((await ask(`127.0.0.1${port}`, '/healthz')).status).toBe(200);
  });

  test('never sets a cookie on a public host', async () => {
    for (const [host, path] of [
      [SEED_HOSTS.canonical, '/'],
      [SEED_HOSTS.alias, '/'],
      [PLATFORM_HOST, '/ejemplo-b'],
      ['desconocido.localhost', '/'],
      [SEED_HOSTS.canonical, '/_tenant/ejemplo-a/es'],
    ] as const) {
      expect((await ask(host, path)).setCookie, `${host}${path}`).toBeUndefined();
    }
  });

  test('reads its routing data from the API, public data only', async ({ request }) => {
    const response = await request.get(`${API_URL}/public/routing`);
    expect(response.ok()).toBe(true);
    const { tenants } = (await response.json()) as {
      tenants: { tenant: { slug: string }; hostnames: { hostname: string }[] }[];
    };
    expect(tenants.map((t) => t.tenant.slug)).toEqual(['ejemplo-a', 'ejemplo-b']);
    expect(tenants.flatMap((t) => t.hostnames.map((h) => h.hostname)).sort()).toEqual(
      [SEED_HOSTS.alias, SEED_HOSTS.canonical].sort(),
    );
  });
});
