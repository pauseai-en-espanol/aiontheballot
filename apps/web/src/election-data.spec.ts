import { NO_PUBLIC_ELECTION, type PublicElection } from '@aiontheballot/domain/public-election';
import { describe, expect, it, vi } from 'vitest';

import { createElectionLoader } from './election-data';

const API = 'http://api.example.test:3001';

const election = (name: string): PublicElection => ({
  election: { slug: 'generales', name: { es: name }, date: null, status: 'live' },
  methodology: null,
  parties: [],
  criteria: [],
  cells: [],
});

const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch whose answers are given by hand, in order, to see what overlaps. */
const byHand = () => {
  const pending: ((response: Response) => void)[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  return { fetch, answer: (body: unknown) => pending.shift()?.(respond(body)) };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the election loader', () => {
  it('refetches when forced, after the fetch on its way, once for a burst, and never older over newer (R151)', async () => {
    const { fetch, answer } = byHand();
    const load = createElectionLoader({ apiUrl: API, fetch });
    const before = load('ejemplo-a', 'generales');
    const forced = [
      load('ejemplo-a', 'generales', { force: true }),
      load('ejemplo-a', 'generales', { force: true }),
    ];
    expect(fetch).toHaveBeenCalledTimes(1);
    answer(election('Antes'));
    expect(await before).toEqual({ kind: 'found', election: election('Antes') });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
    answer(election('Después'));
    for (const result of await Promise.all(forced)) {
      expect(result).toEqual({ kind: 'found', election: election('Después') });
    }
    expect(await load('ejemplo-a', 'generales')).toEqual({
      kind: 'found',
      election: election('Después'),
    });
    // Another election's force doesn't wait for this one's.
    const other = load('ejemplo-a', 'europeas', { force: true });
    const again = load('ejemplo-a', 'generales', { force: true });
    expect(fetch).toHaveBeenCalledTimes(4);
    answer(election('Europeas'));
    answer(election('Otra vez'));
    expect(await other).toEqual({ kind: 'found', election: election('Europeas') });
    expect(await again).toEqual({ kind: 'found', election: election('Otra vez') });
  });

  it("fetches an election from the API and keeps it until it's too old", async () => {
    let now = 0;
    const fetch = vi.fn(async () => respond(election('Generales de ejemplo')));
    const load = createElectionLoader({ apiUrl: API, maxAgeMs: 1_000, fetch, now: () => now });
    expect(await load('ejemplo-a', 'generales')).toEqual({
      kind: 'found',
      election: election('Generales de ejemplo'),
    });
    await load('ejemplo-a', 'generales');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.at(0))).toBe(
      `${API}/public/tenants/ejemplo-a/elections/generales`,
    );
    now = 1_000;
    await load('ejemplo-a', 'generales');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reads the admin's preview's data with its secret, never the public's (PLAN R181)", async () => {
    const fetch = vi.fn(async () => respond(election('Consulta de ejemplo')));
    const token = 'un-secreto-de-vista-previa-de-mas-de-32-caracteres';
    const load = createElectionLoader({ apiUrl: API, fetch, preview: { token } });
    await load('ejemplo-a', 'consulta');
    expect(String(fetch.mock.calls[0]?.at(0))).toBe(
      `${API}/preview/tenants/ejemplo-a/elections/consulta`,
    );
    expect((fetch.mock.calls[0] as unknown[] | undefined)?.at(1)).toMatchObject({
      headers: { 'x-aiontheballot-preview-token': token },
    });
  });

  it('refetches a fresh copy unless it is only seconds old (R148)', async () => {
    let now = 0;
    const fetch = vi.fn(async () => respond(election('Generales de ejemplo')));
    const load = createElectionLoader({ apiUrl: API, fetch, now: () => now });
    await load('ejemplo-a', 'generales');
    now = 4_999;
    await load('ejemplo-a', 'generales', { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    now = 5_000;
    await load('ejemplo-a', 'generales', { fresh: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('says when a refresh brings a change, and only then (R148)', async () => {
    let now = 0;
    let name = 'Uno';
    const fetch = vi.fn(async () => respond(election(name)));
    const changes: [string, string, string | undefined][] = [];
    const load = createElectionLoader({
      apiUrl: API,
      maxAgeMs: 10,
      fetch,
      now: () => now,
      onChange: (slug, next, previous) =>
        changes.push([slug, next.election.name.es ?? '', previous?.election.name.es]),
    });
    await load('ejemplo-a', 'generales');
    now = 20;
    await load('ejemplo-a', 'generales');
    name = 'Dos';
    now = 40;
    await load('ejemplo-a', 'generales');
    expect(changes).toEqual([
      ['ejemplo-a', 'Uno', undefined],
      ['ejemplo-a', 'Dos', 'Uno'],
    ]);
  });

  it("remembers an election the API says isn't public for a while too", async () => {
    const fetch = vi.fn(async () => respond({ error: NO_PUBLIC_ELECTION }, 404));
    const load = createElectionLoader({ apiUrl: API, fetch });
    expect(await load('ejemplo-a', 'no-existe')).toEqual({ kind: 'missing' });
    await load('ejemplo-a', 'no-existe');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a route the API doesn't have", respond({ message: 'Route not found', statusCode: 404 }, 404)],
    ['a refused request', respond({ error: 'Bad Request' }, 400)],
    ['a 404 without a body', new Response('Not found', { status: 404 })],
  ])('takes %s for a failure, never for a missing election', async (_name, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let now = 0;
    let fail = false;
    const fetch = vi.fn(async () => (fail ? answer.clone() : respond(election('Uno'))));
    const load = createElectionLoader({ apiUrl: API, maxAgeMs: 10, fetch, now: () => now });
    await load('ejemplo-a', 'generales');
    fail = true;
    now = 20;
    expect(await load('ejemplo-a', 'generales')).toEqual({
      kind: 'found',
      election: election('Uno'),
    });
    expect(await load('ejemplo-a', 'otra')).toEqual({ kind: 'unavailable' });
  });

  it('keeps the last good copy when a refresh fails, and is unavailable with none', async () => {
    let now = 0;
    let fail = false;
    const fetch = vi.fn(async () => (fail ? respond({}, 503) : respond(election('Uno'))));
    const load = createElectionLoader({ apiUrl: API, maxAgeMs: 10, fetch, now: () => now });
    await load('ejemplo-a', 'generales');
    fail = true;
    now = 20;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await load('ejemplo-a', 'generales')).toEqual({
      kind: 'found',
      election: election('Uno'),
    });
    expect(await load('ejemplo-a', 'otra')).toEqual({ kind: 'unavailable' });
    expect(await createElectionLoader({ apiUrl: undefined })('ejemplo-a', 'generales')).toEqual({
      kind: 'unavailable',
    });
  });

  it('keeps a bounded number of elections, dropping the oldest', async () => {
    const fetch = vi.fn(async () => respond(election('Uno')));
    const load = createElectionLoader({ apiUrl: API, maxEntries: 2, fetch });
    await load('a', 'uno');
    await load('a', 'dos');
    await load('a', 'tres');
    await load('a', 'dos');
    expect(fetch).toHaveBeenCalledTimes(3);
    await load('a', 'uno');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
