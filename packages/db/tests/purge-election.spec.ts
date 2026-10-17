import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER_VALUE = '22023';
const NO_DATA_FOUND = 'P0002';
const RESTRICT_VIOLATION = '23001';

const live = ELECTIONS.liveB;

/** As the admin API acts for a person (withActor): its runtime role, the person and their assurance level. */
const actAs = async (
  client: pg.Client,
  userId: string,
  options: { aal?: '1' | '2'; tokenId?: string } = {},
): Promise<void> => {
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', $2, true),
            set_config('app.token_id', $3, true)`,
    [userId, options.aal ?? '2', options.tokenId ?? ''],
  );
};

const purge = (election: string, confirmation: string, tenant = TENANT_B): string =>
  `SELECT private.purge_election('${tenant}', '${election}', '${confirmation}') AS id`;

/** Rows per table of app with an election_id: `election`'s, or every other election's of `tenant`. */
const electionRows = async (
  client: pg.Client,
  tenant: string,
  election: string,
  which: 'its' | 'others',
): Promise<Record<string, number>> => {
  const { rows: tables } = await client.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'election_id' AND NOT a.attisdropped
      ORDER BY 1`,
  );
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const { rows } = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM app.${name}
        WHERE tenant_id = $1 AND (election_id = $2) IS ${which === 'its' ? 'TRUE' : 'NOT TRUE'}`,
      [tenant, election],
    );
    counts[name] = Number(rows[0]!.n);
  }
  return counts;
};

const count = async (client: pg.Client, sql: string, params: unknown[] = []): Promise<number> =>
  Number((await client.query<{ n: string }>(sql, params)).rows[0]!.n);

describe('purging an election (PLAN R212)', () => {
  it('deletes a live election with everything in it and its audit trail, records it once, and leaves the rest alone', async () => {
    await inRolledBackTransaction(async (client) => {
      const its = await electionRows(client, TENANT_B, live.id, 'its');
      // The point of the purge: published, immutable rows go too.
      expect(its.assessment_revisions).toBeGreaterThan(0);
      expect(its.reports).toBeGreaterThan(0);
      const others = await electionRows(client, TENANT_B, live.id, 'others');
      const tenantA = await electionRows(client, TENANT_A, live.id, 'others');
      const reviews = await count(
        client,
        `SELECT count(*) AS n FROM app.review_events e JOIN app.assessments c ON c.id = e.assessment_id
          WHERE c.election_id = $1`,
        [live.id],
      );
      expect(reviews).toBeGreaterThan(0);
      expect(
        await count(
          client,
          `SELECT count(*) AS n FROM app.audit_log WHERE table_name = 'elections' AND row_id = $1`,
          [live.id],
        ),
      ).toBeGreaterThan(0);
      const auditOfOthers = await count(
        client,
        `SELECT count(*) AS n FROM app.audit_log WHERE tenant_id IS DISTINCT FROM $1`,
        [TENANT_B],
      );

      await actAs(client, USERS.platformAdmin);
      const { rows } = await client.query<{ id: string }>(purge(live.id, live.slug));
      await client.query('RESET ROLE');
      // The deferred links between cells and reports are checked now, as at commit.
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      expect(
        Object.entries(await electionRows(client, TENANT_B, live.id, 'its')).filter(
          ([, n]) => n > 0,
        ),
      ).toEqual([]);
      expect(await electionRows(client, TENANT_B, live.id, 'others')).toEqual(others);
      expect(await electionRows(client, TENANT_A, live.id, 'others')).toEqual(tenantA);
      // Its audit trail goes with it, and the purge writes none of its own: the purge log is the record.
      expect(
        await count(
          client,
          `SELECT count(*) AS n FROM app.audit_log
            WHERE (table_name = 'elections' AND row_id = $1) OR diff -> 'old' ->> 'election_id' = $1
               OR diff -> 'new' ->> 'election_id' = $1`,
          [live.id],
        ),
      ).toBe(0);
      expect(
        await count(
          client,
          `SELECT count(*) AS n FROM app.audit_log WHERE tenant_id IS DISTINCT FROM $1`,
          [TENANT_B],
        ),
      ).toBe(auditOfOthers);
      const { rows: log } = await client.query(
        `SELECT purged_tenant_id, purged_election_id, purged_election_slug, purged_by,
                counts ->> 'elections' AS elections, counts ->> 'assessment_revisions' AS revisions,
                counts ->> 'review_events' AS reviews
           FROM app.purge_log WHERE id = $1`,
        [rows[0]!.id],
      );
      expect(log).toEqual([
        {
          purged_tenant_id: TENANT_B,
          purged_election_id: live.id,
          purged_election_slug: live.slug,
          purged_by: USERS.platformAdmin,
          elections: '1',
          revisions: String(its.assessment_revisions),
          reviews: String(reviews),
        },
      ]);
    });
  });

  it("deletes the files only the election named, and keeps one another election's party still shows", async () => {
    await inRolledBackTransaction(async (client) => {
      const file = async (content: string): Promise<string> =>
        (
          await client.query<{ id: string }>(
            `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, created_by)
             VALUES ($1, 'public_assets', 'image/png', 1, encode(sha256(convert_to($2, 'UTF8')), 'hex'), $3)
             RETURNING id`,
            [TENANT_B, content, USERS.platformAdmin],
          )
        ).rows[0]!.id;
      // Fixture logos, set past the live election's change control: one only it names, one a draft's party shows too.
      await client.query('SET LOCAL session_replication_role = replica');
      const own = await file('logo propio de ejemplo');
      const shared = await file('logo compartido de ejemplo');
      await client.query(
        'UPDATE app.parties SET logo_file_id = $1 WHERE tenant_id = $2 AND id = $3',
        [own, TENANT_B, live.party],
      );
      await client.query(
        'UPDATE app.parties SET logo_file_id = $1 WHERE tenant_id = $2 AND id = ANY ($3)',
        [shared, TENANT_B, [live.secondParty, ELECTIONS.draftB.party]],
      );
      await client.query('SET LOCAL session_replication_role = origin');

      await actAs(client, USERS.platformAdmin);
      await client.query(purge(live.id, live.slug));
      await client.query('RESET ROLE');

      const left = (
        await client.query<{ id: string }>('SELECT id FROM app.files WHERE id = ANY ($1)', [
          [own, shared],
        ])
      ).rows.map((row) => row.id);
      expect(left).toEqual([shared]);
    });
  });

  it('takes the audit trail of rows deleted before it too, and purges an archived election as well', async () => {
    await inRolledBackTransaction(async (client) => {
      const draft = ELECTIONS.draftB;
      // A party added, renamed and deleted before the purge: its audit entries name it, the last two without the purge.
      await actAs(client, USERS.countryAdminB);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
         VALUES ($1, $2, 'partido-borrado', '{"es": "Partido Borrado de Ejemplo"}', '{"es": "PBE"}', 99)
         RETURNING id`,
        [TENANT_B, draft.id],
      );
      const gone = rows[0]!.id;
      await client.query(
        `UPDATE app.parties SET name = '{"es": "Partido Renombrado de Ejemplo"}' WHERE id = $1`,
        [gone],
      );
      await client.query('DELETE FROM app.parties WHERE id = $1', [gone]);
      await client.query('RESET ROLE');
      const trail = `SELECT count(*) AS n FROM app.audit_log WHERE table_name = 'parties' AND row_id = $1`;
      expect(await count(client, trail, [gone])).toBe(3);

      await actAs(client, USERS.platformAdmin);
      await client.query(purge(draft.id, draft.slug));
      await client.query(purge(ELECTIONS.archivedB.id, ELECTIONS.archivedB.slug));
      await client.query('RESET ROLE');
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      expect(await count(client, trail, [gone])).toBe(0);
      for (const election of [draft.id, ELECTIONS.archivedB.id]) {
        expect(
          Object.entries(await electionRows(client, TENANT_B, election, 'its')).filter(
            ([, n]) => n > 0,
          ),
          election,
        ).toEqual([]);
      }
    });
  });

  it('is refused to anyone but a platform admin with a second factor in person, and without the exact short name', async () => {
    await inRolledBackTransaction(async (client) => {
      const before = await electionRows(client, TENANT_B, live.id, 'its');
      const attempts: [string, () => Promise<void>, string, string][] = [
        [
          'a country admin',
          () => actAs(client, USERS.countryAdminB),
          purge(live.id, live.slug),
          INSUFFICIENT_PRIVILEGE,
        ],
        [
          'a platform admin without a second factor',
          () => actAs(client, USERS.platformAdmin, { aal: '1' }),
          purge(live.id, live.slug),
          INSUFFICIENT_PRIVILEGE,
        ],
        [
          "a platform admin's token",
          () =>
            actAs(client, USERS.platformAdmin, { tokenId: '0190f8c4-0000-7000-8000-0000000000ff' }),
          purge(live.id, live.slug),
          INSUFFICIENT_PRIVILEGE,
        ],
        [
          'another short name',
          () => actAs(client, USERS.platformAdmin),
          purge(live.id, `${live.slug}-no`),
          INVALID_PARAMETER_VALUE,
        ],
        [
          "another tenant's election",
          () => actAs(client, USERS.platformAdmin),
          purge(ELECTIONS.liveA.id, ELECTIONS.liveA.slug),
          NO_DATA_FOUND,
        ],
      ];
      for (const [who, act, sql, code] of attempts) {
        await act();
        expect(await errorCode(client, sql), who).toBe(code);
        await client.query('RESET ROLE');
      }
      expect(await electionRows(client, TENANT_B, live.id, 'its')).toEqual(before);
    });
  });

  it("can't be faked: the admin's role can't write the purge log, and the flag alone exempts no immutable row", async () => {
    await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.platformAdmin);
      expect(
        await errorCode(
          client,
          `INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers,
                                      purged_election_id, purge_xact)
           VALUES ('${TENANT_B}', 'test-b', 'x', '{}', '{}', '${live.id}', pg_current_xact_id())`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      await client.query('RESET ROLE');

      // The owner's rights with the flag but no purge of this transaction in the log: still immutable.
      const deleteReviews = (election: string): string => `
        DELETE FROM app.review_events e USING app.assessments c
         WHERE c.id = e.assessment_id AND c.election_id = '${election}'`;
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      await client.query(`SELECT set_config('app.purge_election', $1, true)`, [live.id]);
      expect(await errorCode(client, deleteReviews(live.id))).toBe(RESTRICT_VIOLATION);
      // Nor with a record of another transaction's purge of it, as any past one is.
      await client.query(
        `INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers,
                                    purged_election_id, purged_election_slug, purge_xact)
         VALUES ($1, 'test-b', 'x', '{}', '{}', $2, $3, '1'::xid8)`,
        [TENANT_B, live.id, live.slug],
      );
      expect(await errorCode(client, deleteReviews(live.id))).toBe(RESTRICT_VIOLATION);
      await client.query('RESET ROLE');

      // After a purge, the same transaction gets no exemption back, even with the flag set again to the purged election:
      // the immutable tables refuse, and the audit records.
      await actAs(client, USERS.platformAdmin);
      await client.query(purge(live.id, live.slug));
      expect(
        (await client.query(`SELECT current_setting('app.purge_election', true) AS flag`)).rows,
      ).toEqual([{ flag: '' }]);
      await client.query(`SELECT set_config('app.purge_election', $1, true)`, [live.id]);
      const audited = `SELECT count(*) AS n FROM app.audit_log WHERE table_name = 'parties' AND row_id = $1`;
      const before = await count(client, audited, [ELECTIONS.draftB.party]);
      await client.query(
        `UPDATE app.parties SET name = '{"es": "Partido Auditado de Ejemplo"}' WHERE id = $1`,
        [ELECTIONS.draftB.party],
      );
      expect(await count(client, audited, [ELECTIONS.draftB.party])).toBe(before + 1);
      await client.query('RESET ROLE');
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      await client.query(`SELECT set_config('app.purge_election', $1, true)`, [live.id]);
      expect(await errorCode(client, deleteReviews(ELECTIONS.liveA.id))).toBe(RESTRICT_VIOLATION);
      await client.query('RESET ROLE');
    });
  });
});
