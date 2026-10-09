import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import {
  CORE_CRITERION,
  ELECTIONS,
  FILES,
  ORGANIZATIONS,
  TENANT_A,
  TENANT_B,
  USERS,
} from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const INSUFFICIENT_PRIVILEGE = '42501';

const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    return fn(client);
  });

const newElection = (columns: Record<string, string>): string => {
  const values = {
    tenant_id: `'${TENANT_A}'`,
    slug: `'elecciones-de-prueba'`,
    type: `'other'`,
    name: `'{"es": "Elecciones de prueba"}'`,
    ...columns,
  };
  return `INSERT INTO app.elections (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
};

describe('app.elections', () => {
  it.each([
    ['a locale-shaped slug, which would clash with a locale prefix', { slug: `'ca'` }],
    ['a region-shaped locale slug', { slug: `'es-mx'` }],
    ['a general election limited to a territory', { type: `'general'`, territory_code: `'XA-01'` }],
    ['a regional election without a territory', { type: `'regional'` }],
    ['a malformed territory code', { type: `'regional'`, territory_code: `'XA01'` }],
  ])('refuses %s', async (_name, columns) => {
    expect(await actingAs(USERS.editorA, (c) => errorCode(c, newElection(columns)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('refuses a freeze window that ends before it starts', async () => {
    expect(
      await actingAs(USERS.countryAdminA, (c) =>
        errorCode(
          c,
          `UPDATE app.elections SET frozen_from = now(), frozen_until = now() - interval '1 hour' WHERE id = '${ELECTIONS.liveA.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('always starts as a draft, with four-eyes review on and no freeze', async () => {
    const attempts: Record<string, string>[] = [
      { status: `'live'` },
      { require_second_reviewer: 'false' },
      { frozen_from: 'now()' },
      { went_live_at: 'now()' },
    ];
    for (const columns of attempts) {
      expect(await actingAs(USERS.countryAdminA, (c) => errorCode(c, newElection(columns)))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it('keeps slugs unique per tenant', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(c, newElection({ slug: `'${ELECTIONS.liveA.slug}'` })),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(
          c,
          newElection({ tenant_id: `'${TENANT_B}'`, slug: `'otras-elecciones-de-prueba'` }),
        ),
      ),
    ).toBeNull();
  });
});

describe('an election and its structure stay in one tenant and one election', () => {
  it.each([
    [
      "a methodology for another tenant's election",
      `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
       VALUES ('${TENANT_A}', '${ELECTIONS.emptyB.id}', 'demands', '${ORGANIZATIONS.A.id}', '{"es": "x"}')`,
    ],
    [
      "a party in another tenant's election",
      `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
       VALUES ('${TENANT_A}', '${ELECTIONS.draftB.id}', 'partido-cruzado', '{"es": "x"}', '{"es": "x"}', 1)`,
    ],
    [
      "an external reviewer on another tenant's methodology",
      `INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
       VALUES ('${TENANT_A}', '${ELECTIONS.draftB.methodology}', 'x', 'x')`,
    ],
    [
      "another tenant's image as a party logo",
      `UPDATE app.parties SET logo_file_id = '${FILES.logoA.id}' WHERE id = '${ELECTIONS.draftB.party}'`,
    ],
  ])('refuses %s', async (_name, sql) => {
    expect(await inRolledBackTransaction((c) => errorCode(c, sql))).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('allows one methodology per election', async () => {
    expect(
      await inRolledBackTransaction((c) =>
        errorCode(
          c,
          `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
           VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', 'demands', '${ORGANIZATIONS.A.id}', '{"es": "x"}')`,
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });
});

describe('app.parties', () => {
  it('takes its logo only from the public_assets bucket, so no source document can become public', async () => {
    const codes = await actingAs(USERS.editorA, async (c) => [
      await errorCode(
        c,
        `UPDATE app.parties SET logo_file_id = '${FILES.sourceA.id}' WHERE id = '${ELECTIONS.draftA.party}'`,
      ),
      await errorCode(
        c,
        `UPDATE app.parties SET logo_file_id = '${FILES.logoA.id}' WHERE id = '${ELECTIONS.draftA.party}'`,
      ),
    ]);
    expect(codes).toEqual([CHECK_VIOLATION, null]);
  });

  it.each([
    ['a malformed colour', `colour = 'red'`],
    ['an uppercase colour', `colour = '#ABCDEF'`],
    ['an empty list of territories', `territory_codes = '{}'`],
    ['a malformed territory', `territory_codes = '{XA01}'`],
    ['a website that is not a URL', `website = 'partido.example'`],
    ['a slug already used in the election', `slug = 'partido-ejemplo-b'`],
  ])('refuses %s', async (_name, set) => {
    const code = await actingAs(USERS.editorA, (c) =>
      errorCode(c, `UPDATE app.parties SET ${set} WHERE id = '${ELECTIONS.draftA.party}'`),
    );
    expect([CHECK_VIOLATION, UNIQUE_VIOLATION]).toContain(code);
  });
});

describe('core criteria and the public cache key', () => {
  it('bump the tenants whose criteria use them', async () => {
    const [before, after] = await actingAs(USERS.platformAdmin, async (client) => {
      const read = async (): Promise<Record<string, number>> =>
        Object.fromEntries(
          (
            await client.query<{ tenant_id: string; version: string }>(
              'SELECT tenant_id, version FROM app.public_versions',
            )
          ).rows.map((r) => [r.tenant_id, Number(r.version)]),
        );
      await client.query('RESET ROLE');
      const first = await read();
      await client.query(
        `UPDATE app.core_criteria SET title = '{"es": "Otro título"}' WHERE id = $1`,
        [CORE_CRITERION],
      );
      return [first, await read()];
    });
    expect(after[TENANT_A]).toBe((before[TENANT_A] ?? 0) + 1);
    expect(after[TENANT_B]).toBe(before[TENANT_B]);
  });
});
