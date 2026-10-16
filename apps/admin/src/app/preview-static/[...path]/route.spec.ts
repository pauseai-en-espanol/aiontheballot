import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebAnswer } from '../../../preview';

// What the web app answers; it stands in for the real call.
const web = vi.hoisted(() => ({
  calls: [] as string[],
  answer: { status: 200, headers: {}, body: Buffer.from('') } as WebAnswer,
}));

vi.mock('../../../preview', async (original) => ({
  ...(await original<typeof import('../../../preview')>()),
  fetchFromWeb: async (_config: unknown, path: string) => {
    web.calls.push(path);
    return web.answer;
  },
}));

const { GET } = await import('./route');

const get = (...path: string[]) =>
  GET(new Request(`https://admin.example.test/preview-static/${path.join('/')}`), {
    params: Promise.resolve({ path }),
  });

const notFound = async (response: Promise<Response>) =>
  String(
    (
      (await response.then(
        () => undefined,
        (error: unknown) => error,
      )) as { digest?: unknown } | undefined
    )?.digest,
  ).endsWith(';404');

beforeEach(() => {
  vi.stubEnv('WEB_URL', 'http://web.example.test:3000');
  vi.stubEnv('PREVIEW_HOST', 'vista-previa.example.test');
  vi.stubEnv('PREVIEW_TOKEN', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
  web.calls.length = 0;
  web.answer = { status: 200, headers: { 'content-type': 'text/css' }, body: Buffer.from('p{}') };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the preview's build assets (ADR-0005, PLAN R174)", () => {
  it("passes on the web app's content-hashed stylesheets and fonts, sandboxed and cached for good", async () => {
    const response = await get('chunks', '2f2hh1zkwa9g6.css');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('p{}');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-security-policy')).toMatch(/^sandbox allow-same-origin;/u);
    expect(web.calls).toEqual(['/_next/static/chunks/2f2hh1zkwa9g6.css']);
  });

  it('refuses anything else before asking, and what the web app has not', async () => {
    for (const path of [
      ['chunks', 'a.js'],
      ['media', 'x.svg'],
      ['..', 'server', 'app', 'page.js'],
      ['BUILD_ID'],
    ]) {
      expect(await notFound(get(...path)), path.join('/')).toBe(true);
    }
    expect(web.calls).toEqual([]);
    web.answer = { status: 404, headers: {}, body: Buffer.from('') };
    expect(await notFound(get('chunks', 'gone.css'))).toBe(true);
  });
});
