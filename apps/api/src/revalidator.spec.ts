import { describe, expect, it, vi } from 'vitest';

import { createRevalidator } from './revalidator.js';

/** A fetch that answers 202. */
const ok = () => vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));

/** A fetch's target, as text. */
const urlOf = (input: string | URL | Request | undefined): string =>
  input === undefined
    ? ''
    : typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

describe('telling the public site a site changed (R151)', () => {
  it("posts to every pod the web's Service resolves to, what changed and nothing else", async () => {
    const fetch = ok();
    const resolve = vi.fn(async () => ['10.0.0.12', '10.0.0.13', 'fd00::7']);
    const notify = createRevalidator({
      url: 'http://aiontheballot-web-pods:3000',
      fetch,
      resolve,
      onError: () => undefined,
    });
    notify({ tenant: 'ejemplo-a', election: 'generales' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(resolve).toHaveBeenCalledWith('aiontheballot-web-pods');
    expect(
      fetch.mock.calls.map(([url]) => urlOf(url)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ).toEqual([
      'http://10.0.0.12:3000/_internal/revalidate',
      'http://10.0.0.13:3000/_internal/revalidate',
      'http://[fd00::7]:3000/_internal/revalidate',
    ]);
    const [, init] = fetch.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      tenant: 'ejemplo-a',
      election: 'generales',
    });
  });

  it('posts straight to an address given as one, as the e2e stack has it', async () => {
    const fetch = ok();
    const resolve = vi.fn(async () => []);
    createRevalidator({ url: 'http://127.0.0.1:4100', fetch, resolve, onError: () => undefined })({
      tenant: 'ejemplo-a',
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(resolve).not.toHaveBeenCalled();
    expect(urlOf(fetch.mock.calls[0]?.[0])).toBe('http://127.0.0.1:4100/_internal/revalidate');
  });

  it('says how many replicas missed it, and never throws at the writer', async () => {
    const errors: string[] = [];
    let call = 0;
    const fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        throw new TypeError('fetch failed');
      }
      return new Response(null, { status: call === 2 ? 404 : 202 });
    });
    createRevalidator({
      url: 'http://web:3000',
      fetch,
      resolve: async () => ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
      onError: (error) => errors.push(error.message),
    })({ tenant: 'ejemplo-a' });
    await vi.waitFor(() =>
      expect(errors).toEqual(["2 of 3 web replicas weren't told a site changed"]),
    );
    const lost: string[] = [];
    createRevalidator({
      url: 'http://web:3000',
      fetch,
      resolve: async () => Promise.reject(new Error('ENOTFOUND')),
      onError: (error) => lost.push(error.message),
    })({ tenant: 'ejemplo-a' });
    await vi.waitFor(() => expect(lost).toEqual(['ENOTFOUND']));
  });
});
