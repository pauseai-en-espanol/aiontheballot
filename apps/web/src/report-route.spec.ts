import { describe, expect, it, vi } from 'vitest';

import { handleReportPost, MIN_FILL_MS } from './report-route';

const NOW = 1_900_000_000_000;
const TARGET = { slug: 'ejemplo-a', election: 'generales', formHref: '/generales/informar' };

const post = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request('http://ejemplo-a.example.test/generales/informar/enviar', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': '203.0.113.9',
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });

const FORM = {
  kind: 'error_report',
  message: 'Un mensaje inventado sobre una valoración de ejemplo.',
  t: String(NOW - 10_000),
  website: '',
};

const answering = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

const run = (request: Request, fetch = answering(202, { outcome: 'accepted' })) =>
  handleReportPost(request, TARGET, { apiUrl: 'http://api.example.test', fetch, now: () => NOW });

describe('the right-of-reply form route (R149)', () => {
  it('sends a report to the API with the visitor, and comes back to the form saying so', async () => {
    const fetch = answering(202, { outcome: 'accepted' });
    const answer = await run(
      post({
        ...FORM,
        partido: 'partido-a',
        criterio: 'criterio-1',
        name: ' Persona ',
        representative: '1',
      }),
      fetch,
    );
    expect(answer.status).toBe(303);
    expect(answer.headers.get('location')).toBe('/generales/informar?enviado=sent#formulario');
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://api.example.test/public/tenants/ejemplo-a/reports');
    expect(new Headers(init.headers).get('x-visitor-address')).toBe('203.0.113.9');
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'error_report',
      message: FORM.message,
      election: 'generales',
      party: 'partido-a',
      criterion: 'criterio-1',
      name: 'Persona',
      partyRepresentative: true,
    });
  });

  it('answers a bot as if sent, and sends nothing: the hidden field filled, or the form sent too fast', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const fields of [
      { ...FORM, website: 'https://spam.example.test' },
      { ...FORM, t: String(NOW - MIN_FILL_MS + 1) },
      // A little "from the future": another server's clock, a second ahead.
      { ...FORM, t: String(NOW + 1_000) },
    ]) {
      const fetch = answering(202, { outcome: 'accepted' });
      const answer = await run(post(fields), fetch);
      expect(answer.headers.get('location')).toBe('/generales/informar?enviado=sent#formulario');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('tells a person whose form is too old, or stamped far ahead, to send it again: never that it went', async () => {
    for (const t of [String(NOW - 2 * 24 * 60 * 60 * 1000), String(NOW + 10 * 60_000), 'ayer']) {
      const fetch = answering(202, { outcome: 'accepted' });
      const answer = await run(post({ ...FORM, t }), fetch);
      expect(answer.headers.get('location')).toBe('/generales/informar?enviado=expired#formulario');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("counts the visitor by the gateway's own entry, the last, never one a client added", async () => {
    const fetch = answering(202, { outcome: 'accepted' });
    await run(post(FORM, { 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }), fetch);
    const [, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Headers(init.headers).get('x-visitor-address')).toBe('203.0.113.9');
  });

  it("takes a post from a browser without Fetch Metadata only with this host's Origin", async () => {
    const without = (origin: string | undefined) => {
      const headers: Record<string, string> = {
        'content-type': 'application/x-www-form-urlencoded',
        host: 'ejemplo-a.example.test',
        ...(origin === undefined ? {} : { origin }),
      };
      return new Request('http://ejemplo-a.example.test/generales/informar/enviar', {
        method: 'POST',
        headers,
        body: new URLSearchParams(FORM).toString(),
      });
    };
    expect((await run(without('http://ejemplo-a.example.test'))).status).toBe(303);
    expect((await run(without('https://otro.example.test'))).status).toBe(403);
    expect((await run(without('null'))).status).toBe(403);
    expect((await run(without(undefined))).status).toBe(403);
  });

  it("takes posts from the site's own pages only, as a form", async () => {
    expect((await run(post(FORM, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await run(post(FORM, { 'content-type': 'application/json' }))).status).toBe(415);
  });

  it('says what went wrong, keeping the cell, so a person can fix it', async () => {
    for (const [status, body, outcome] of [
      [400, { outcome: 'links' }, 'links'],
      [400, { outcome: 'invalid' }, 'invalid'],
      [429, { outcome: 'limit' }, 'limit'],
      [404, { outcome: 'not-found' }, 'failed'],
      [503, { error: 'unavailable' }, 'failed'],
    ] as const) {
      const answer = await run(
        post({ ...FORM, partido: 'partido-a', criterio: 'criterio-1' }),
        answering(status, body),
      );
      expect(answer.headers.get('location')).toBe(
        `/generales/informar?partido=partido-a&criterio=criterio-1&enviado=${outcome}#formulario`,
      );
    }
    expect((await run(post({ ...FORM, kind: 'otra' }))).headers.get('location')).toContain(
      'enviado=invalid',
    );
    const unreachable = vi.fn(async () => Promise.reject(new Error('down')));
    expect((await run(post(FORM), unreachable)).headers.get('location')).toContain(
      'enviado=failed',
    );
  });
});
