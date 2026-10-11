import { describe, expect, it, vi } from 'vitest';

import { handleSignupPost, type SignupTarget } from './signup-route';

const API = 'http://api.example.test:3001';
const TARGET: SignupTarget = {
  slug: 'ejemplo-a',
  locale: 'es',
  hrefs: { home: '/', confirm: '/avisos/confirmar', unsubscribe: '/avisos/baja' },
};

const post = (
  body: string,
  { query = '', headers = {} }: { query?: string; headers?: Record<string, string> } = {},
): Request =>
  new Request(`http://ejemplo-a.example.test/avisos${query}`, {
    method: 'POST',
    body,
    headers: {
      host: 'ejemplo-a.example.test',
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': '198.51.100.1, 203.0.113.7',
      ...headers,
    },
  });

const api = (status: number, json: unknown) =>
  vi.fn<(input: URL | RequestInfo, init?: RequestInit) => Promise<Response>>(async () =>
    Response.json(json, { status }),
  );

const sent = (fetch: ReturnType<typeof api>) =>
  fetch.mock.calls.map(([input, init]) => ({
    url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
    body: JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown,
    visitor: new Headers(init?.headers).get('x-visitor-address'),
  }));

describe('the signup form target', () => {
  it('signs up through the API and goes back to the form with the outcome, the box ticked only if sent', async () => {
    const fetch = api(202, { outcome: 'accepted' });
    const response = await handleSignupPost(post('email=persona%40example.org&future=1'), TARGET, {
      apiUrl: API,
      fetch,
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/?aviso=accepted#avisos');
    expect(sent(fetch)).toEqual([
      {
        url: `${API}/public/tenants/ejemplo-a/signups`,
        body: { email: 'persona@example.org', locale: 'es', futureElections: true },
        visitor: '203.0.113.7',
      },
    ]);
    await handleSignupPost(post('email=persona%40example.org'), TARGET, { apiUrl: API, fetch });
    expect(sent(fetch)[1]?.body).toMatchObject({ futureElections: false });
  });

  it.each([
    [400, { outcome: 'invalid' }, 'invalid'],
    [429, { error: 'limit' }, 'limit'],
    [503, { error: 'unavailable' }, 'unavailable'],
    [503, { outcome: 'failed' }, 'failed'],
    [409, { outcome: 'unavailable' }, 'unavailable'],
    [404, { outcome: 'not-found' }, 'unavailable'],
    [500, {}, 'failed'],
  ])('says %i %j as %s', async (status, json, outcome) => {
    const response = await handleSignupPost(post('email=a%40example.org'), TARGET, {
      apiUrl: API,
      fetch: api(status, json),
    });
    expect(response.headers.get('location')).toBe(`/?aviso=${outcome}#avisos`);
  });

  it('says failed when the API is unreachable or not configured', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    for (const options of [{ apiUrl: API, fetch: down }, { apiUrl: undefined }]) {
      const response = await handleSignupPost(post('email=a%40example.org'), TARGET, options);
      expect(response.headers.get('location')).toBe('/?aviso=failed#avisos');
    }
  });

  it.each([
    ['confirm', { confirmed: true }, '/avisos/confirmar?r=ok'],
    ['confirm', { confirmed: false }, '/avisos/confirmar?r=invalid'],
    ['unsubscribe', { unsubscribed: true }, '/avisos/baja?r=ok'],
  ])('%s: posts the token and goes back without it (%j)', async (action, json, location) => {
    const fetch = api(200, json);
    const token = 'a'.repeat(43);
    const response = await handleSignupPost(post(`action=${action}&t=${token}`), TARGET, {
      apiUrl: API,
      fetch,
    });
    expect(response.headers.get('location')).toBe(location);
    expect(sent(fetch)[0]).toMatchObject({
      url: `${API}/public/tenants/ejemplo-a/signups/${action}`,
      body: { token },
    });
  });

  it("takes a mail client's one-click unsubscribe from anywhere (RFC 8058), and nothing else", async () => {
    const fetch = api(200, { unsubscribed: true });
    const token = 'b'.repeat(43);
    const oneClick = post('List-Unsubscribe=One-Click', {
      query: `?action=unsubscribe&t=${token}`,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const response = await handleSignupPost(oneClick, TARGET, { apiUrl: API, fetch });
    expect(response.status).toBe(200);
    expect(sent(fetch)).toMatchObject([
      { url: `${API}/public/tenants/ejemplo-a/signups/unsubscribe`, body: { token } },
    ]);
    // The one-click address with any other body is no one-click: from another site, refused.
    const notOneClick = post('List-Unsubscribe=Later', {
      query: `?action=unsubscribe&t=${token}`,
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect((await handleSignupPost(notOneClick, TARGET, { apiUrl: API, fetch })).status).toBe(403);
    // A cross-site post of anything else is refused, signups first among them.
    const crossSite = post('email=a%40example.org', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect((await handleSignupPost(crossSite, TARGET, { apiUrl: API, fetch })).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts an Origin of this host from a browser without Fetch Metadata, and no other', async () => {
    const fetch = api(202, { outcome: 'accepted' });
    const without = (origin: string) =>
      new Request('http://ejemplo-a.example.test/avisos', {
        method: 'POST',
        body: 'email=a%40example.org',
        headers: {
          host: 'ejemplo-a.example.test',
          origin,
          'content-type': 'application/x-www-form-urlencoded',
        },
      });
    expect(
      (
        await handleSignupPost(without('http://ejemplo-a.example.test'), TARGET, {
          apiUrl: API,
          fetch,
        })
      ).status,
    ).toBe(303);
    expect(
      (await handleSignupPost(without('https://otro.example.test'), TARGET, { apiUrl: API, fetch }))
        .status,
    ).toBe(403);
  });

  it('refuses a body that is too large or not a form', async () => {
    const fetch = api(202, { outcome: 'accepted' });
    expect(
      (await handleSignupPost(post(`email=${'a'.repeat(5000)}`), TARGET, { apiUrl: API, fetch }))
        .status,
    ).toBe(413);
    const json = post('{"email":"a@example.org"}', {
      headers: { 'content-type': 'application/json' },
    });
    expect((await handleSignupPost(json, TARGET, { apiUrl: API, fetch })).status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the token out of every referrer and cache', async () => {
    const response = await handleSignupPost(post('action=confirm&t=x'), TARGET, {
      apiUrl: API,
      fetch: api(200, { confirmed: false }),
    });
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
