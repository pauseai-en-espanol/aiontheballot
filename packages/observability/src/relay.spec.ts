import { describe, expect, it, vi } from 'vitest';

import { RELAY_PLACEHOLDER_DSN } from './browser.js';
import { parseDsn } from './dsn.js';
import { RELAY_MAX_BYTES, relayErrors } from './relay.js';

const dsn = parseDsn('http://webkey@glitchtip.test/3');

const envelope = (header: unknown, ...items: string[]) =>
  [JSON.stringify(header), ...items].join('\n');

const item = [JSON.stringify({ type: 'event' }), JSON.stringify({ message: 'Fallo de ejemplo' })];

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('https://example-tenant.test/_relay/errors', {
    method: 'POST',
    body,
    headers: { cookie: '__Host-x=1', 'x-forwarded-for': '203.0.113.7', ...headers },
  });

const upstreamOk = () =>
  vi.fn<typeof fetch>(
    async () => new Response('{"id":"1"}', { status: 200, headers: { 'set-cookie': 'a=b' } }),
  );

describe('relayErrors', () => {
  it('forwards to the configured project with the DSN replaced and nothing from the client', async () => {
    const send = upstreamOk();
    const body = envelope(
      {
        event_id: 'e1',
        dsn: RELAY_PLACEHOLDER_DSN,
        trace: { public_key: 'relay' },
        sent_at: 'now',
      },
      ...item,
    );

    const response = await relayErrors(post(body), { dsn, fetch: send });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('');

    expect(send).toHaveBeenCalledOnce();
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('http://glitchtip.test/api/3/envelope/?sentry_version=7&sentry_key=webkey');
    expect(init?.headers).toEqual({ 'content-type': 'application/x-sentry-envelope' });
    expect(init?.redirect).toBe('error');
    const lines = new TextDecoder().decode(init?.body as Uint8Array).split('\n');
    expect(JSON.parse(lines[0] ?? '')).toEqual({ event_id: 'e1', dsn: dsn.value, sent_at: 'now' });
    expect(lines.slice(1)).toEqual(item);
  });

  it('accepts and drops envelopes when no DSN is configured', async () => {
    const send = upstreamOk();

    const response = await relayErrors(post(envelope({}, ...item)), {
      dsn: undefined,
      fetch: send,
    });

    expect(response.status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects bodies over the limit, whether declared or streamed', async () => {
    const send = upstreamOk();
    const big = envelope({}, 'x'.repeat(RELAY_MAX_BYTES));

    expect((await relayErrors(post(big), { dsn, fetch: send })).status).toBe(413);
    const stream = new Blob([big]).stream();
    const undeclared = new Request('https://example-tenant.test/_relay/errors', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await relayErrors(undeclared, { dsn, fetch: send })).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', ''],
    ['a header that is not JSON', 'not json\n{}'],
    ['a header that is not an object', '[1]\n{}'],
  ])('rejects %s', async (_, body) => {
    const send = upstreamOk();

    expect((await relayErrors(post(body), { dsn, fetch: send })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('passes on rate limiting so the SDK backs off', async () => {
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '60', 'x-sentry-rate-limits': '60::org' },
        }),
    );

    const response = await relayErrors(post(envelope({}, ...item)), { dsn, fetch: send });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-sentry-rate-limits')).toBe('60::org');
  });

  it('answers 502 when GlitchTip is unreachable', async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });

    expect((await relayErrors(post(envelope({}, ...item)), { dsn, fetch: send })).status).toBe(502);
  });
});
