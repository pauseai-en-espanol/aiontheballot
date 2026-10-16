import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { AUDIT_PAGE, listAudit } from '../src/admin/audit.js';
import { getCell } from '../src/admin/cells.js';
import { listCorrections } from '../src/admin/corrections.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A, TENANT_A, USERS } from './fixtures.js';

/** Acts as `user` at aal2, as the admin's routes do through withActor. */
const as = async (trx: Transaction<DB>, user: string) => {
  await sql`RESET ROLE`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
};

const NAME = { es: 'Elecciones generales de ejemplo' };

describe('the records (editorial workflow H1, H3; PLAN R150)', () => {
  it("list a correction's later revisions and approved structural changes, newest first, never a first rating", async () => {
    await inRolledBackTransaction(async (trx) => {
      const [party] = ELECTIONS_A.live.parties;
      await as(trx, USERS.editorA);
      const { rows } = await sql<{ id: string }>`
        INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                         proposed_value, public_note)
        VALUES (${TENANT_A}, ${LIVE_A.id}, 'update', 'party', ${party}, 'website',
                '"https://ejemplo.test/web-nueva"', '{"es": "Una nota pública inventada."}')
        RETURNING id`.execute(trx);
      await as(trx, USERS.countryAdminA);
      await sql`UPDATE app.change_requests SET state = 'approved' WHERE id = ${rows[0]?.id}`.execute(
        trx,
      );
      await as(trx, USERS.reviewerA);
      const entries = await listCorrections(trx, { id: LIVE_A.id, name: NAME });
      expect(entries[0]).toEqual({
        kind: 'structure',
        at: expect.any(String),
        action: 'update',
        targetKind: 'party',
        target: expect.objectContaining({ es: expect.any(String) }),
        field: 'website',
        previousValue: null,
        newValue: 'https://ejemplo.test/web-nueva',
        publicNote: { es: 'Una nota pública inventada.' },
      });
      // The fixtures' one published cell has only its first rating: no correction.
      expect(entries.filter((entry) => entry.kind === 'revision')).toEqual([]);
      // Another election's log never holds it.
      expect(
        (await listCorrections(trx, { id: ELECTIONS_A.archived.id, name: NAME })).some(
          (entry) =>
            entry.kind === 'structure' && entry.newValue === 'https://ejemplo.test/web-nueva',
        ),
      ).toBe(false);
      // Nobody outside the site reads them.
      await as(trx, USERS.countryAdminB);
      expect(await listCorrections(trx, { id: LIVE_A.id, name: NAME })).toEqual([]);
    });
  });

  it('leave out what was republished in preview, and number the rest as the public does (PLAN R181)', async () => {
    await inRolledBackTransaction(async (trx) => {
      const preview = ELECTIONS_A.preview;
      const [party] = preview.parties;
      const [criterion] = preview.criteria;
      // Two revisions in preview, then the election live and a correction: written directly, triggers off (the
      // publish flow is packages/db's to test).
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      const cell = await sql<{ id: string }>`
        INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, state, generation, updated_by)
        VALUES (${TENANT_A}, ${preview.id}, ${party}, ${criterion}, 'published', 3, ${USERS.editorA})
        RETURNING id`.execute(trx);
      await sql`UPDATE app.elections SET status = 'live', went_live_at = now() - interval '1 day'
                 WHERE id = ${preview.id}`.execute(trx);
      await sql`
        INSERT INTO app.assessment_revisions (tenant_id, assessment_id, election_id, party_id, criterion_id,
                                              reviewed_version, revision_no, rating, summary, change_kind, public_note,
                                              published_in_preview, published_at)
        VALUES (${TENANT_A}, ${cell.rows[0]?.id}, ${preview.id}, ${party}, ${criterion}, 0, 1, 'meets',
                '{"es": "Resumen inventado"}', 'initial', NULL, true, now() - interval '3 days'),
               (${TENANT_A}, ${cell.rows[0]?.id}, ${preview.id}, ${party}, ${criterion}, 1, 2, 'meets',
                '{"es": "Resumen inventado"}', 'update', '{"es": "Nota inventada en vista previa"}', true,
                now() - interval '2 days'),
               (${TENANT_A}, ${cell.rows[0]?.id}, ${preview.id}, ${party}, ${criterion}, 2, 3, 'does_not_meet',
                '{"es": "Resumen inventado y corregido"}', 'correction', '{"es": "Nota inventada"}', false, now())`.execute(
        trx,
      );
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
      await as(trx, USERS.reviewerA);
      const entries = await listCorrections(trx, { id: preview.id, name: NAME });
      expect(entries).toEqual([
        expect.objectContaining({
          kind: 'revision',
          change: 'correction',
          revisionNo: 2,
          rating: 'does_not_meet',
          publicNote: { es: 'Nota inventada' },
          // By id too: the admin's cell pages are addressed by their party's and criterion's ids.
          party: expect.objectContaining({ id: preview.parties[0] }),
          criterion: expect.objectContaining({ id: criterion }),
        }),
      ]);
    });
  });

  it("show a revision's private record to the site's members: who wrote it, who published it", async () => {
    await inRolledBackTransaction(async (trx) => {
      const { rows } = await sql<{ party_id: string; criterion_id: string }>`
        SELECT party_id, criterion_id FROM app.assessments WHERE id = ${LIVE_A.cells.published}`.execute(
        trx,
      );
      const [pair] = rows;
      await as(trx, USERS.reviewerA);
      const cell = await getCell(trx, LIVE_A.id, pair?.party_id ?? '', pair?.criterion_id ?? '');
      const [revision] = cell?.revisions ?? [];
      expect(revision?.internal).toEqual({
        contributors: expect.arrayContaining([expect.any(String)]),
        publisher: expect.any(String),
        selfReviewed: expect.any(Boolean),
        reportId: null,
      });
      expect(revision?.internal?.contributors.length).toBeGreaterThan(0);
    });
  });

  it("show a site's audit log to its country admins and platform admins only, filtered and a page at a time", async () => {
    await inRolledBackTransaction(async (trx) => {
      await as(trx, USERS.countryAdminA);
      const all = await listAudit(trx, { tenantId: TENANT_A });
      expect(all.entries.length).toBeGreaterThan(0);
      expect(all.tables.length).toBeGreaterThan(0);
      // Personal-data columns never reach it (the audit trigger), so neither a report's message nor a name.
      expect(JSON.stringify(all.entries)).not.toMatch(/"message"|"email"/u);
      const [table] = all.tables;
      const filtered = await listAudit(trx, { tenantId: TENANT_A, table });
      expect(filtered.entries.every((entry) => entry.table === table)).toBe(true);
      const [first] = all.entries;
      const byRow = await listAudit(trx, { tenantId: TENANT_A, rowId: first?.rowId ?? '' });
      expect(byRow.entries.every((entry) => entry.rowId === first?.rowId)).toBe(true);
      // A page at a time: with more entries than a page, the next one starts where this one ended.
      await sql`RESET ROLE`.execute(trx);
      await sql`
        INSERT INTO app.audit_log (tenant_id, actor_id, action, table_name, row_id, diff)
        SELECT ${TENANT_A}, NULL, 'update', 'pagina_de_prueba', n::text, '{}'::jsonb
          FROM generate_series(1, ${AUDIT_PAGE + 5}) AS n`.execute(trx);
      await as(trx, USERS.countryAdminA);
      const firstPage = await listAudit(trx, { tenantId: TENANT_A, table: 'pagina_de_prueba' });
      expect(firstPage.entries).toHaveLength(AUDIT_PAGE);
      expect(firstPage.next).toBe(firstPage.entries.at(-1)?.id);
      const secondPage = await listAudit(trx, {
        tenantId: TENANT_A,
        table: 'pagina_de_prueba',
        before: firstPage.next ?? '',
      });
      expect(secondPage.entries).toHaveLength(5);
      expect(secondPage.next).toBeNull();
      expect(
        secondPage.entries.every((entry) => BigInt(entry.id) < BigInt(firstPage.next ?? '0')),
      ).toBe(true);
      const future = await listAudit(trx, { tenantId: TENANT_A, from: '2999-01-01T00:00:00Z' });
      expect(future.entries).toEqual([]);
      // An editor, a reviewer or another site's admin reads none of it (RLS); the platform's own entries are a
      // platform admin's.
      for (const user of [USERS.editorA, USERS.reviewerA, USERS.countryAdminB]) {
        await as(trx, user);
        expect((await listAudit(trx, { tenantId: TENANT_A })).entries, user).toEqual([]);
        expect((await listAudit(trx, { tenantId: null })).entries, user).toEqual([]);
      }
      await as(trx, USERS.platformAdmin);
      const site = await listAudit(trx, { tenantId: TENANT_A });
      expect(site.entries.length).toBeGreaterThan(0);
      const platform = await listAudit(trx, { tenantId: null });
      expect(platform.entries.length).toBeGreaterThan(0);
      // Each page is its own: a platform admin, who reads every entry, sees only the site's on the site's page, and
      // only the platform's on the platform's.
      await sql`RESET ROLE`.execute(trx);
      const tenantsOf = async (ids: string[]) =>
        (
          await sql<{ tenant_id: string | null }>`
            SELECT DISTINCT tenant_id FROM app.audit_log WHERE id = ANY (${ids}::bigint[])`.execute(
            trx,
          )
        ).rows.map((row) => row.tenant_id);
      expect(await tenantsOf(site.entries.map((entry) => entry.id))).toEqual([TENANT_A]);
      expect(await tenantsOf(platform.entries.map((entry) => entry.id))).toEqual([null]);
    });
  });
});
