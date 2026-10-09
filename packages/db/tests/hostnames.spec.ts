import type pg from 'pg';

import { normalizeHost } from '@aiontheballot/domain/routing';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { PLATFORM_HOSTNAME, TENANT_A, TENANT_B, TOMBSTONE_HOSTNAME, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const RESTRICT_VIOLATION = '23001';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/** Runs `fn` as the superuser with the fixture platform admin as actor (fixture-style writes). */
const asPlatform = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.platformAdmin],
    );
    return fn(client);
  });

const insertHost = (hostname: string, tenant = TENANT_A, extra = ''): string =>
  `INSERT INTO app.tenant_hostnames (hostname, tenant_id${extra ? ', is_canonical, verified_at' : ''})
   VALUES (${literal(hostname)}, '${tenant}'${extra})`;

describe('app.hostname', () => {
  const valid = [
    'iaenlasurnas.test',
    'es.plataforma.test',
    'xn--urnas-9ra.test',
    'a.b.c.example.test',
  ];
  const invalid = [
    'Example.test',
    'example.test.',
    'example.test:443',
    'urnas-ñ.test',
    'localhost',
    '-a.example.test',
    'a-.example.test',
    'a_b.example.test',
    'example.123',
    `${'a'.repeat(64)}.test`,
    `${'a.'.repeat(127)}test`,
  ];

  it('accepts normalized DNS names, which resolve() leaves unchanged', async () => {
    const codes = await inRolledBackTransaction(async (client) =>
      Promise.all(valid.map((h) => errorCode(client, `SELECT ${literal(h)}::app.hostname`))),
    );
    expect(codes).toEqual(valid.map(() => null));
    expect(valid.map((h) => normalizeHost(h))).toEqual(valid);
  });

  it.each(invalid)('rejects %j', async (hostname) => {
    const code = await inRolledBackTransaction((client) =>
      errorCode(client, `SELECT ${literal(hostname)}::app.hostname`),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});

describe('app.tenant_hostnames', () => {
  it('refuses a duplicate hostname, also for another tenant', async () => {
    expect(await asPlatform((c) => errorCode(c, insertHost('test-a.example.test', TENANT_B)))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it('refuses a reserved platform hostname or a tombstoned one', async () => {
    expect(await asPlatform((c) => errorCode(c, insertHost(PLATFORM_HOSTNAME)))).toBe(
      RESTRICT_VIOLATION,
    );
    expect(await asPlatform((c) => errorCode(c, insertHost(TOMBSTONE_HOSTNAME)))).toBe(
      RESTRICT_VIOLATION,
    );
  });

  it('refuses to reserve a hostname a tenant already has', async () => {
    expect(
      await asPlatform((c) =>
        errorCode(
          c,
          `INSERT INTO app.platform_hostnames (hostname) VALUES ('test-b.example.test')`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('allows one canonical hostname per tenant, verified and not retired', async () => {
    expect(
      await asPlatform((c) =>
        errorCode(c, insertHost('otra-a.example.test', TENANT_A, ', true, now()')),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await asPlatform((c) =>
        errorCode(
          c,
          `UPDATE app.tenant_hostnames SET is_canonical = true WHERE hostname = 'pendiente-a.example.test'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await asPlatform((c) =>
        errorCode(
          c,
          `UPDATE app.tenant_hostnames SET retired_at = now() WHERE hostname = 'test-a.example.test'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('refuses to make a retired hostname canonical', async () => {
    await asPlatform(async (client) => {
      await client.query(
        `UPDATE app.tenant_hostnames SET is_canonical = false WHERE hostname = 'test-a.example.test'`,
      );
      expect(
        await errorCode(
          client,
          `UPDATE app.tenant_hostnames SET is_canonical = true WHERE hostname = 'antiguo-a.example.test'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('stamps verification and retirement at the transaction time, once', async () => {
    await asPlatform(async (client) => {
      const { rows } = await client.query(
        `UPDATE app.tenant_hostnames SET verified_at = '2000-01-01' WHERE hostname = 'pendiente-a.example.test'
         RETURNING verified_at = now() AS now`,
      );
      expect(rows).toEqual([{ now: true }]);
      for (const sql of [
        `UPDATE app.tenant_hostnames SET verified_at = NULL WHERE hostname = 'test-a.example.test'`,
        `UPDATE app.tenant_hostnames SET verified_at = now() - interval '1 day' WHERE hostname = 'test-a.example.test'`,
        `UPDATE app.tenant_hostnames SET retired_at = NULL WHERE hostname = 'antiguo-a.example.test'`,
        `INSERT INTO app.tenant_hostnames (hostname, tenant_id, retired_at) VALUES ('ya-retirado.example.test', '${TENANT_A}', now())`,
      ]) {
        expect(await errorCode(client, sql)).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it('never deletes a hostname or moves it to another tenant, not even as the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(
        await errorCode(
          client,
          `DELETE FROM app.tenant_hostnames WHERE hostname = 'antiguo-a.example.test'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(
          client,
          `UPDATE app.tenant_hostnames SET tenant_id = '${TENANT_B}' WHERE hostname = 'antiguo-a.example.test'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, `DELETE FROM app.hostname_tombstones`)).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });
});
