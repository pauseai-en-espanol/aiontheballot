import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { refusal, seed, SEED_TENANTS } from '../seeds/seed.js';
import { inRolledBackTransaction } from './db.js';
import { TENANTS } from './rls/matrix.js';

describe('the seed guard', () => {
  it.each([
    ['postgres://aiontheballot_owner@localhost:5432/aiontheballot', {}],
    ['postgres://aiontheballot_owner@127.0.0.1:5432/aiontheballot', {}],
    ['postgres://aiontheballot_owner@[::1]:5432/aiontheballot', {}],
  ])('lets %s through', (url, env) => {
    expect(refusal(url, env)).toBeUndefined();
  });

  it.each([
    [
      'a database on another machine',
      'postgres://aiontheballot_owner@postgres.aiontheballot.svc:5432/aiontheballot',
      {},
    ],
    [
      'NODE_ENV=production',
      'postgres://aiontheballot_owner@localhost:5432/aiontheballot',
      { NODE_ENV: 'production' },
    ],
    ['a URL that is not one', 'not a url', {}],
  ])('refuses %s', (_name, url, env) => {
    expect(refusal(url, env)).toBeTypeOf('string');
  });
});

/** In a rolled-back transaction, as the owner (as `pnpm db:seed` connects). */
const asOwner = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_owner');
    return fn(client);
  });

describe('seeding', () => {
  it('refuses a database that holds other tenants, writing nothing', async () => {
    await asOwner(async (client) => {
      await expect(seed(client)).rejects.toThrow(/other tenants/);
    });
  });

  it('fills an empty database through the real triggers, once', async () => {
    await asOwner(async (client) => {
      for (const t of Object.values(TENANTS)) {
        await client.query('SELECT private.purge_tenant($1)', [t.id]);
      }
      expect(await seed(client)).toBe('seeded');
      expect(await seed(client)).toBe('already seeded');

      // What the public may route by: the active tenants, and A's verified hostnames only.
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows: tenants } = await client.query<{ slug: string }>(
        'SELECT slug FROM app.tenants ORDER BY slug',
      );
      expect(tenants.map((t) => t.slug)).toEqual([SEED_TENANTS.A.slug, SEED_TENANTS.B.slug]);
      const { rows: hostnames } = await client.query<{ hostname: string; is_canonical: boolean }>(
        'SELECT hostname, is_canonical FROM app.tenant_hostnames ORDER BY hostname',
      );
      expect(hostnames).toEqual([
        { hostname: 'alias-a.localhost', is_canonical: false },
        { hostname: 'ejemplo-a.localhost', is_canonical: true },
      ]);
      const { rows: revisions } = await client.query('SELECT rating FROM app.current_revisions');
      expect(revisions).toEqual([{ rating: 'meets' }]);
    });
  });
});
