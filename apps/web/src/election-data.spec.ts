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

describe('the election loader', () => {
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
