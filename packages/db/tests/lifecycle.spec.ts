import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, ORGANIZATIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

/** As `userId` through the admin role, with deferred checks at the end of each statement. */
const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    return fn(client);
  });

const asCountryAdminA = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  actingAs(USERS.countryAdminA, fn);
const status = (id: string, to: string): string =>
  `UPDATE app.elections SET status = '${to}' WHERE id = '${id}'`;

describe('election status', () => {
  it('moves from draft to live to archived, stamping went_live_at (no role may write it) at the transaction time', async () => {
    await asCountryAdminA(async (client) => {
      const { rows } = await client.query(
        `UPDATE app.elections SET status = 'live' WHERE id = $1
         RETURNING went_live_at = now() AS now`,
        [ELECTIONS.draftA.id],
      );
      expect(rows).toEqual([{ now: true }]);
      expect(await errorCode(client, status(ELECTIONS.draftA.id, 'archived'))).toBeNull();
    });
  });

  it.each([
    ['draft to archived', ELECTIONS.draftA.id, 'archived'],
    ['live back to draft', ELECTIONS.liveA.id, 'draft'],
    ['archived back to live', ELECTIONS.archivedA.id, 'live'],
    ['archived back to draft', ELECTIONS.archivedA.id, 'draft'],
  ])('never goes from %s', async (_name, id, to) => {
    expect(await asCountryAdminA((c) => errorCode(c, status(id, to)))).toBe(RESTRICT_VIOLATION);
  });
});

describe('going live', () => {
  it.each([
    ['without a methodology', [], ELECTIONS.emptyA.id],
    [
      'with an untranslated election name',
      [
        // Withdrawn first: an announced election can't lose its default-locale name (elections.spec.ts).
        `UPDATE app.elections SET announced = false, name = '{"en": "Example election"}' WHERE id = '${ELECTIONS.draftA.id}'`,
      ],
      ELECTIONS.draftA.id,
    ],
    [
      'with an untranslated methodology',
      [
        `UPDATE app.methodologies SET body = '{"en": "Example"}' WHERE id = '${ELECTIONS.draftA.methodology}'`,
      ],
      ELECTIONS.draftA.id,
    ],
    [
      'with an untranslated party name',
      [
        `UPDATE app.parties SET short_name = '{"en": "EP"}' WHERE id = '${ELECTIONS.draftA.secondParty}'`,
      ],
      ELECTIONS.draftA.id,
    ],
    [
      'with a criterion that has no short title',
      [
        `UPDATE app.criteria SET short_title = NULL WHERE id = '${ELECTIONS.draftA.secondCriterion}'`,
      ],
      ELECTIONS.draftA.id,
    ],
    [
      'with an untranslated short title',
      [
        `UPDATE app.criteria SET short_title = '{"en": "Example"}' WHERE id = '${ELECTIONS.draftA.criterion}'`,
      ],
      ELECTIONS.draftA.id,
    ],
    [
      'with an untranslated criterion',
      [
        `UPDATE app.criteria SET description = '{"en": "Example"}' WHERE id = '${ELECTIONS.draftA.criterion}'`,
      ],
      ELECTIONS.draftA.id,
    ],
  ])('is refused %s', async (_name, setup, id) => {
    const code = await asCountryAdminA(async (client) => {
      for (const sql of setup) {
        await client.query(sql);
      }
      return errorCode(client, status(id, 'live'));
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('is refused for an inactive tenant', async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(c, status(ELECTIONS.draftInactive.id, 'live')),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe("a public election's criteria", () => {
  it('keep their short title in the default locale, whoever writes', async () => {
    const codes = await inRolledBackTransaction(async (client) => [
      await errorCode(
        client,
        `UPDATE app.criteria SET short_title = NULL WHERE id = '${ELECTIONS.liveA.criterion}'`,
      ),
      await errorCode(
        client,
        `UPDATE app.criteria SET short_title = '{"en": "Example"}' WHERE id = '${ELECTIONS.liveA.criterion}'`,
      ),
    ]);
    expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it('may lack one while the election is a draft', async () => {
    expect(
      await asCountryAdminA((client) =>
        errorCode(
          client,
          `UPDATE app.criteria SET short_title = NULL WHERE id = '${ELECTIONS.draftA.criterion}'`,
        ),
      ),
    ).toBeNull();
  });
});

describe('once live', () => {
  it.each([
    [
      'the election slug',
      `UPDATE app.elections SET slug = 'otro-slug' WHERE id = '${ELECTIONS.liveA.id}'`,
    ],
    [
      'the election type and territory',
      `UPDATE app.elections SET type = 'regional', territory_code = 'XA-02' WHERE id = '${ELECTIONS.liveA.id}'`,
    ],
    [
      'a party slug',
      `UPDATE app.parties SET slug = 'otro-slug' WHERE id = '${ELECTIONS.liveA.party}'`,
    ],
    [
      'a criterion slug',
      `UPDATE app.criteria SET slug = 'otro-slug' WHERE id = '${ELECTIONS.liveA.criterion}'`,
    ],
  ])('keeps %s, which share images print', async (_name, sql) => {
    expect(await asCountryAdminA((c) => errorCode(c, sql))).toBe(RESTRICT_VIOLATION);
  });

  it('still lets slugs change while a draft', async () => {
    expect(
      await asCountryAdminA((c) =>
        errorCode(
          c,
          `UPDATE app.parties SET slug = 'otro-slug' WHERE id = '${ELECTIONS.draftA.party}'`,
        ),
      ),
    ).toBeNull();
  });
});

describe('an archived election', () => {
  it.each([
    [
      'its name',
      `UPDATE app.elections SET name = '{"es": "Otro"}' WHERE id = '${ELECTIONS.archivedA.id}'`,
    ],
    [
      'its freeze window',
      `UPDATE app.elections SET frozen_from = now() WHERE id = '${ELECTIONS.archivedA.id}'`,
    ],
    [
      'a party',
      `UPDATE app.parties SET colour = '#000000' WHERE id = '${ELECTIONS.archivedA.party}'`,
    ],
    [
      'a new criterion',
      `INSERT INTO app.criteria (tenant_id, election_id, slug, title, description, display_order)
       VALUES ('${TENANT_A}', '${ELECTIONS.archivedA.id}', 'nuevo', '{"es": "x"}', '{"es": "x"}', 9)`,
    ],
    [
      'its methodology',
      `UPDATE app.methodologies SET body = '{"es": "Otra"}' WHERE id = '${ELECTIONS.archivedA.methodology}'`,
    ],
    [
      'a new external reviewer',
      `INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
       VALUES ('${TENANT_A}', '${ELECTIONS.archivedA.methodology}', 'x', 'x')`,
    ],
  ])('keeps %s as it is', async (_name, sql) => {
    expect(await asCountryAdminA((c) => errorCode(c, sql))).toBe(RESTRICT_VIOLATION);
  });
});

describe('territories', () => {
  it.each([
    [
      "an election territory outside the tenant's country",
      `INSERT INTO app.elections (tenant_id, slug, type, territory_code, name)
       VALUES ('${TENANT_A}', 'regionales-fuera', 'regional', 'XB-01', '{"es": "x"}')`,
    ],
    [
      "a party territory outside the tenant's country",
      `UPDATE app.parties SET territory_codes = '{XA-01,XB-02}' WHERE id = '${ELECTIONS.draftA.party}'`,
    ],
  ])('refuses %s', async (_name, sql) => {
    expect(await asCountryAdminA((c) => errorCode(c, sql))).toBe(CHECK_VIOLATION);
  });

  it("refuses to change a tenant's country while its territories use it", async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(c, `UPDATE app.tenants SET country_code = 'XZ' WHERE id = '${TENANT_A}'`),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('methodologies', () => {
  const methodology = (kind: string, owner: string | null): string =>
    `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
     VALUES ('${TENANT_A}', '${ELECTIONS.emptyA.id}', '${kind}', ${owner ? `'${owner}'` : 'NULL'}, '{"es": "x"}')`;

  it("use the tenant's kind", async () => {
    expect(await asCountryAdminA((c) => errorCode(c, methodology('descriptive', null)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('name the operator or an endorser as the owner of the demands', async () => {
    const codes = await actingAs(USERS.platformAdmin, async (client) => [
      await errorCode(client, methodology('demands', ORGANIZATIONS.unlinked.id)),
      await client
        .query(
          `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'endorser')`,
          [TENANT_A, ORGANIZATIONS.unlinked.id],
        )
        .then(() => errorCode(client, methodology('demands', ORGANIZATIONS.unlinked.id))),
    ]);
    expect(codes).toEqual([CHECK_VIOLATION, null]);
  });

  it("fix the tenant's kind once one exists", async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(
          c,
          `UPDATE app.tenants SET methodology_kind = 'descriptive' WHERE id = '${TENANT_B}'`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });
});

describe('four-eyes review', () => {
  it('is turned off by a platform admin only, and the change is audited', async () => {
    const log = await actingAs(USERS.platformAdmin, async (client) => {
      await client.query(`UPDATE app.elections SET require_second_reviewer = false WHERE id = $1`, [
        ELECTIONS.liveA.id,
      ]);
      await client.query('RESET ROLE');
      return (
        await client.query<{ actor_id: string; diff: unknown }>(
          `SELECT actor_id, diff FROM app.audit_log WHERE table_name = 'elections' AND row_id = $1 AND at = now()`,
          [ELECTIONS.liveA.id],
        )
      ).rows;
    });
    expect(log).toEqual([
      {
        actor_id: USERS.platformAdmin,
        diff: { old: { require_second_reviewer: true }, new: { require_second_reviewer: false } },
      },
    ]);
  });
});
