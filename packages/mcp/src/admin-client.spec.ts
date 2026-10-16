import { describe, expect, it } from 'vitest';

import { AdminError, adminSettings, createAdminClient } from './admin-client.js';

/** A fictional token of the admin's shape. */
const TOKEN = `aiontheballot_${'a'.repeat(43)}`;

describe('adminSettings (PLAN R204)', () => {
  it('takes the admin’s address over HTTPS, or over HTTP on this machine only, and a token of the admin’s shape', () => {
    expect(
      adminSettings({
        AIONTHEBALLOT_ADMIN_URL: 'https://admin.example.org/x',
        AIONTHEBALLOT_TOKEN: TOKEN,
      }),
    ).toEqual({ origin: 'https://admin.example.org', token: TOKEN });
    expect(
      adminSettings({
        AIONTHEBALLOT_ADMIN_URL: 'http://localhost:4000',
        AIONTHEBALLOT_TOKEN: TOKEN,
      }).origin,
    ).toBe('http://localhost:4000');
    for (const address of [
      'http://admin.example.org',
      'ftp://admin.example.org',
      'no es una dirección',
    ]) {
      expect(() =>
        adminSettings({ AIONTHEBALLOT_ADMIN_URL: address, AIONTHEBALLOT_TOKEN: TOKEN }),
      ).toThrow();
    }
    expect(() =>
      adminSettings({
        AIONTHEBALLOT_ADMIN_URL: 'https://admin.example.org',
        AIONTHEBALLOT_TOKEN: 'otro',
      }),
    ).toThrow(/Tokens for tools/);
    expect(() => adminSettings({ AIONTHEBALLOT_TOKEN: TOKEN })).toThrow(/AIONTHEBALLOT_ADMIN_URL/);
  });
});

describe('createAdminClient', () => {
  const recorded: { url: string; init: RequestInit }[] = [];
  const fake =
    (status: number, body: unknown): typeof fetch =>
    async (url, init) => {
      recorded.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
      return new Response(body === undefined ? null : JSON.stringify(body), { status });
    };

  it('sends the token, never a cookie, follows no redirect, and reads the answer', async () => {
    recorded.length = 0;
    const admin = createAdminClient(
      { origin: 'https://admin.example.org', token: TOKEN },
      fake(200, { tenants: [] }),
    );
    expect(await admin.get('/api/tenants')).toEqual({ tenants: [] });
    const [{ url, init }] = recorded as [{ url: string; init: RequestInit }];
    expect(url).toBe('https://admin.example.org/api/tenants');
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, accept: 'application/json' });
    expect(init.redirect).toBe('error');
  });

  it('turns a refusal into an error with the API’s key and field', async () => {
    const admin = createAdminClient(
      { origin: 'https://admin.example.org', token: TOKEN },
      fake(400, { error: 'invalid', field: 'colour' }),
    );
    const error = await admin.send('POST', '/api/x', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminError);
    expect(error).toMatchObject({ status: 400, key: 'invalid', field: 'colour' });
  });
});
