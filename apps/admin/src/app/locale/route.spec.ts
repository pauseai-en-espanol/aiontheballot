import { describe, expect, it } from 'vitest';

import { POST } from './route';

const FORM = 'application/x-www-form-urlencoded';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://admin.example/locale', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': FORM, ...headers },
      body,
    }),
  );

describe('POST /locale', () => {
  it('keeps the language in a preference cookie on this host and goes back to the page', async () => {
    const response = await post('locale=es&back=%2Ft%2Fejemplo-a%2Fmembers');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/t/ejemplo-a/members');
    expect(response.headers.get('set-cookie')).toBe(
      '__Host-locale=es; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('takes the form a script sends, with its charset', async () => {
    const response = await post(new URLSearchParams({ locale: 'en', back: '/' }), {
      'content-type': `${FORM};charset=UTF-8`,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toMatch(/^__Host-locale=en;/);
  });

  it('goes back to this host only', async () => {
    const response = await post('locale=es&back=%2F%09%2Fotro.example');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
  });

  it("takes posts from the admin's own pages only", async () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      const response = await post('locale=es&back=%2F', { 'sec-fetch-site': site });
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    // Without Fetch Metadata, the Origin must be this host.
    const request = (headers: Record<string, string>) =>
      POST(
        new Request('https://admin.example/locale', {
          method: 'POST',
          headers: { host: 'admin.example', 'content-type': FORM, ...headers },
          body: 'locale=es&back=%2F',
        }),
      );
    expect((await request({ origin: 'https://admin.example' })).status).toBe(303);
    expect((await request({ origin: 'https://otro.example' })).status).toBe(403);
    expect((await request({ origin: 'null' })).status).toBe(403);
    expect((await request({})).status).toBe(403);
  });

  it('refuses a language it lacks, or none', async () => {
    for (const body of ['locale=fr&back=%2F', 'back=%2F', '', null]) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  it('reads only a small form', async () => {
    const multipart = new FormData();
    multipart.set('locale', 'es');
    expect((await post(multipart, { 'content-type': 'multipart/form-data' })).status).toBe(415);
    expect((await post('locale=es', { 'content-type': 'text/plain' })).status).toBe(415);
    const large = `locale=es&back=%2F${'a'.repeat(5000)}`;
    expect((await post(large)).status).toBe(413);
    // Without a length, too: it is cut off as it is read.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(large));
        controller.close();
      },
    });
    const streamed = await POST(
      new Request('https://admin.example/locale', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin', 'content-type': FORM },
        body: stream,
        duplex: 'half',
      } as RequestInit),
    );
    expect(streamed.status).toBe(413);
  });
});
