import { describe, expect, it, vi } from 'vitest';

import {
  createCoalescer,
  handleRevalidate,
  isInternalHost,
  MAX_REVALIDATIONS,
  parseRevalidation,
} from './revalidate';

const post = (body: unknown, host = '10.0.0.12:3000') =>
  new Request('http://web/_internal/revalidate', {
    method: 'POST',
    headers: { host, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const targets = (sites = ['ejemplo-a']) => ({
  routing: vi.fn(async (tenant: string) => sites.includes(tenant)),
  home: vi.fn(async () => ({ elections: ['generales', 'europeas'] })),
  election: vi.fn(async () => undefined),
});

describe('instant refresh on publish (R151)', () => {
  it('answers only on a host the gateway never forwards', () => {
    for (const host of [
      '10.0.0.12:3000',
      '127.0.0.1:4100',
      '[fd00::1]:3000',
      'localhost:3000',
      'aiontheballot-web-pods.aiontheballot.svc.cluster.local:3000',
    ]) {
      expect(isInternalHost(host), host).toBe(true);
    }
    for (const host of [
      null,
      '',
      'iaenlasurnas.es',
      'ejemplo-a.localhost:4100',
      'cluster.local.example.org',
      // Not an address, nor a port: what a gateway with looser matching might still forward.
      'iaenlasurnas.es:abc',
      'iaenlasurnas.es:',
      'iaenlasurnas.es:80:80',
      '999.999.999.999',
      '10.0.0',
      'fd00::1',
      '[iaenlasurnas.es]',
      // Hex digits, colons and dots in brackets, but no IPv6 address.
      '[::::]',
      '[1.2.3.4]',
      '[abc]',
      '10.0.0.12:3000 ',
    ]) {
      expect(isInternalHost(host), String(host)).toBe(false);
    }
  });

  it('takes a site and, optionally, an election, by their slugs only', () => {
    expect(parseRevalidation({ tenant: 'ejemplo-a' })).toEqual({ tenant: 'ejemplo-a' });
    expect(parseRevalidation({ tenant: 'ejemplo-a', election: 'generales' })).toEqual({
      tenant: 'ejemplo-a',
      election: 'generales',
    });
    for (const value of [
      null,
      {},
      { tenant: '../x' },
      { tenant: 'a', election: 'B' },
      { tenant: 1 },
    ]) {
      expect(parseRevalidation(value), JSON.stringify(value)).toBeUndefined();
    }
  });

  it('refetches the routing, the site and the election named, at once', async () => {
    const t = targets();
    const answer = await handleRevalidate(
      post({ tenant: 'ejemplo-a', election: 'generales' }),
      t,
      createCoalescer(),
    );
    expect(answer.status).toBe(202);
    await vi.waitFor(() => expect(t.election).toHaveBeenCalledWith('ejemplo-a', 'generales'));
    expect(t.routing).toHaveBeenCalled();
    expect(t.home).toHaveBeenCalledWith('ejemplo-a');
    expect(t.election).toHaveBeenCalledTimes(1);
  });

  it("refetches every election the site lists when none is named: the operator's name shows on all", async () => {
    const t = targets();
    await handleRevalidate(post({ tenant: 'ejemplo-a' }), t, createCoalescer());
    await vi.waitFor(() => expect(t.election).toHaveBeenCalledTimes(2));
  });

  it('is a 404 on a public host, and refuses what names nothing', async () => {
    const t = targets();
    expect(
      (
        await handleRevalidate(
          post({ tenant: 'ejemplo-a' }, 'iaenlasurnas.es'),
          t,
          createCoalescer(),
        )
      ).status,
    ).toBe(404);
    expect((await handleRevalidate(post({ tenant: '..' }), t, createCoalescer())).status).toBe(400);
    expect(t.routing).not.toHaveBeenCalled();
  });

  it('runs one refetch at a time per site and election, and one more if asked meanwhile', async () => {
    const coalesce = createCoalescer();
    let release: () => void = () => undefined;
    let runs = 0;
    const work = vi.fn(async () => {
      runs += 1;
      if (runs === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });
    const first = coalesce('a/generales', work);
    void coalesce('a/generales', work);
    void coalesce('a/generales', work);
    release();
    await first;
    // The first, and one more for the two asked while it ran: never three.
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('refetches nothing more for a site the routing table, refetched, does not list', async () => {
    const t = targets([]);
    expect(
      (await handleRevalidate(post({ tenant: 'inventado' }), t, createCoalescer())).status,
    ).toBe(202);
    await vi.waitFor(() => expect(t.routing).toHaveBeenCalledWith('inventado'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.home).not.toHaveBeenCalled();
    expect(t.election).not.toHaveBeenCalled();
  });

  it('runs a bounded number of refetches at once, and answers 503 past it', async () => {
    const coalesce = createCoalescer(2);
    const gates: (() => void)[] = [];
    const work = () =>
      new Promise<void>((resolve) => {
        gates.push(resolve);
      });
    expect(coalesce('a/*', work)).toBeDefined();
    expect(coalesce('b/*', work)).toBeDefined();
    expect(coalesce('c/*', work)).toBeUndefined();
    // A key already running still takes another request.
    expect(coalesce('a/*', work)).toBeDefined();
    const t = targets();
    const full = createCoalescer(MAX_REVALIDATIONS);
    for (let n = 0; n < MAX_REVALIDATIONS; n += 1) {
      void full(`s${n}/*`, work);
    }
    expect((await handleRevalidate(post({ tenant: 'ejemplo-a' }), t, full)).status).toBe(503);
    for (const release of gates) {
      release();
    }
  });
});
