import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebAnswer } from '../../../../../preview';

// What the API says of the member (`/api/t/{slug}`), and what the web app answers; both stand in for the real calls.
const api = vi.hoisted(() => ({ status: 200 }));
const web = vi.hoisted(() => ({
  calls: [] as { path: string; options: unknown }[],
  answer: { status: 200, headers: {}, body: Buffer.from('') } as WebAnswer,
}));

vi.mock('../../../../../api', () => ({
  getFromApi: async () => ({ status: api.status, body: '{}' }),
}));
vi.mock('../../../../../session', () => ({
  forwardedRequest: async () => ({ host: 'admin.example.test', cookie: 'sesion=de-prueba' }),
}));
vi.mock('../../../../../preview', async (original) => ({
  ...(await original<typeof import('../../../../../preview')>()),
  fetchFromWeb: async (_config: unknown, path: string, options: unknown) => {
    web.calls.push({ path, options });
    return web.answer;
  },
}));

const { GET } = await import('./route');

const get = (tenant: string, path?: string[], search = '') =>
  GET(new Request(`https://admin.example.test/t/${tenant}/preview${search}`), {
    params: Promise.resolve({ tenant, path }),
  });

/** What Next's notFound() and redirect() throw, for its router to answer with. */
const digest = async (response: Promise<Response>) =>
  String(
    (
      (await response.then(
        () => undefined,
        (error: unknown) => error,
      )) as { digest?: unknown } | undefined
    )?.digest,
  );

beforeEach(() => {
  vi.stubEnv('WEB_URL', 'http://web.example.test:3000');
  vi.stubEnv('PREVIEW_HOST', 'vista-previa.example.test');
  vi.stubEnv('PREVIEW_TOKEN', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
  api.status = 200;
  web.calls.length = 0;
  web.answer = {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: Buffer.from(
      '<link rel="stylesheet" href="/_next/static/chunks/a.css"/><script>x()</script><p>Hola</p>',
    ),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a site's preview route (ADR-0005, PLAN R174)", () => {
  it("serves a member the site's page, sandboxed, script-free, with its assets moved", async () => {
    const response = await get('ejemplo-a', ['es', 'partidos'], '?vista=tabla');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox allow-same-origin;/u);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe(
      '<link rel="stylesheet" href="/preview-static/chunks/a.css"/><p>Hola</p>',
    );
    expect(web.calls).toEqual([
      {
        path: '/ejemplo-a/es/partidos?vista=tabla',
        options: { root: '/t/ejemplo-a/preview', acceptLanguage: null },
      },
    ]);
  });

  it('sends someone signed out to sign in, and anyone the API refuses to a 404, never asking the web app', async () => {
    api.status = 401;
    expect(await digest(get('ejemplo-a'))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/sign-in;/u);
    for (const status of [403, 404, 500, 503]) {
      api.status = status;
      expect(await digest(get('ejemplo-a')), String(status)).toMatch(/;404$/u);
    }
    expect(web.calls).toEqual([]);
  });

  it("refuses a slug or a path that isn't a site's, before asking anyone", async () => {
    for (const [tenant, path] of [
      ['Ejemplo-A', undefined],
      ['ejemplo_a', undefined],
      ['ejemplo-a', ['..', 'ejemplo-b']],
      ['ejemplo-a', ['.']],
      ['ejemplo-a', ['a%2Fb']],
      ['ejemplo-a', ['a\\b']],
    ] as const) {
      expect(await digest(get(tenant, path ? [...path] : undefined)), String(path)).toMatch(
        /;404$/u,
      );
    }
    expect(web.calls).toEqual([]);
  });

  it('keeps a redirect inside the preview, and answers 404 to one that leaves it', async () => {
    web.answer = {
      status: 307,
      headers: { location: '/t/ejemplo-a/preview/es' },
      body: Buffer.from(''),
    };
    const inside = await get('ejemplo-a');
    expect([inside.status, inside.headers.get('location')]).toEqual([
      307,
      '/t/ejemplo-a/preview/es',
    ]);
    expect(inside.headers.get('content-security-policy')).toMatch(/^sandbox/u);
    web.answer = {
      status: 308,
      headers: { location: 'https://ejemplo-a.example.test/' },
      body: Buffer.from(''),
    };
    expect(await digest(get('ejemplo-a'))).toMatch(/;404$/u);
  });

  it('is off, a 404, without its settings or with a weak token', async () => {
    vi.stubEnv('PREVIEW_TOKEN', 'corto');
    expect(await digest(get('ejemplo-a'))).toMatch(/;404$/u);
    vi.stubEnv('PREVIEW_TOKEN', '');
    expect(await digest(get('ejemplo-a'))).toMatch(/;404$/u);
    expect(web.calls).toEqual([]);
  });
});
