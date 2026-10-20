import type { DB } from '@aiontheballot/db/generated/db';

import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createElectionSource } from '../src/election-data.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A, TENANT_A, USERS } from './fixtures.js';

const asPublic = (trx: Transaction<DB>) => sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);

describe('a public election', () => {
  it('holds its parties, criteria and methodology, and every published revision of its cells', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const data = await createElectionSource(trx)('test-a', LIVE_A.slug);
      // No intro written (PLAN R217): none, never a placeholder.
      expect(data?.election).toMatchObject({ slug: LIVE_A.slug, status: 'live', intro: null });
      expect(data?.parties.map((p) => p.id)).toEqual(ELECTIONS_A.live.parties);
      expect(data?.criteria.map((c) => c.id)).toEqual(ELECTIONS_A.live.criteria);
      expect(data?.methodology).toMatchObject({ kind: 'demands', reviewers: [expect.any(Object)] });
      // The fixtures' one published cell; every other cell is pending, with no revision at all.
      expect(data?.cells).toHaveLength(1);
      const [cell] = data?.cells ?? [];
      expect(cell?.revisions).toHaveLength(1);
      expect(cell?.revisions[0]).toMatchObject({
        revisionNo: 1,
        rating: LIVE_A.publishedRating,
        changeKind: 'initial',
      });
      expect(Date.parse(cell?.revisions[0]?.publishedAt ?? '')).not.toBeNaN();
      // A source's public columns, the ones it asks for: nothing of its stored copy but the hash. (The column grants,
      // tested in packages/db's RLS matrix, are what keep the others out.)
      expect(cell?.revisions[0]?.evidence.length).toBeGreaterThan(0);
      for (const item of cell?.revisions[0]?.evidence ?? []) {
        expect(Object.keys(item.source).sort()).toEqual(
          ['archiveUrl', 'kind', 'language', 'retrievedAt', 'sha256', 'title', 'url'].sort(),
        );
      }
    });
  });

  it("holds every approved change to its structure, newest first, by its target's name (the corrections log)", async () => {
    await inRolledBackTransaction(async (trx) => {
      const [party] = ELECTIONS_A.live.parties;
      // An editor proposes, a country admin approves: what the admin's change requests do (CR1).
      const as = async (user: string) => {
        await sql`RESET ROLE`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
          trx,
        );
        await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
      };
      await as(USERS.editorA);
      const { rows } = await sql<{ id: string }>`
        INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                         proposed_value, public_note)
        VALUES (${TENANT_A}, ${LIVE_A.id}, 'update', 'party', ${party}, 'website',
                '"https://ejemplo.test/web-nueva"', '{"es": "Una nota pública inventada."}')
        RETURNING id`.execute(trx);
      await as(USERS.countryAdminA);
      await sql`UPDATE app.change_requests SET state = 'approved' WHERE id = ${rows[0]?.id}`.execute(
        trx,
      );
      await sql`RESET ROLE`.execute(trx);
      await asPublic(trx);
      const data = await createElectionSource(trx)('test-a', LIVE_A.slug);
      // Newest first: this one before any the fixtures hold.
      expect(data?.changes?.[0]).toEqual({
        action: 'update',
        targetKind: 'party',
        target: expect.objectContaining({ es: expect.any(String) }),
        field: 'website',
        // The fixture party had no website.
        previousValue: null,
        newValue: 'https://ejemplo.test/web-nueva',
        publicNote: { es: 'Una nota pública inventada.' },
        approvedAt: expect.any(String),
      });
      // Another election's log never holds it.
      const other = await createElectionSource(trx)('test-a', ELECTIONS_A.archived.slug);
      expect(other).toBeDefined();
      expect(
        other?.changes?.some((change) => change.newValue === 'https://ejemplo.test/web-nueva'),
      ).toBe(false);
      const times = (data?.changes ?? []).map((change) => change.approvedAt);
      expect(times).toEqual([...times].sort().reverse());
    });
  });

  it("never publishes an external reviewer's names in the log, and doesn't name one retired (R26)", async () => {
    await inRolledBackTransaction(async (trx) => {
      const reviewer = ELECTIONS_A.live.reviewer;
      const as = async (user: string) => {
        await sql`RESET ROLE`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
          trx,
        );
        await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
      };
      const approve = async (action: string, field: string | null, value: string | null) => {
        await as(USERS.editorA);
        const { rows } = await sql<{ id: string }>`
          INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                           proposed_value, public_note)
          VALUES (${TENANT_A}, ${LIVE_A.id}, ${action}::app.change_action, 'methodology_reviewer', ${reviewer},
                  ${field}, ${value}::jsonb, '{"es": "Una nota pública inventada."}')
          RETURNING id`.execute(trx);
        await as(USERS.countryAdminA);
        await sql`UPDATE app.change_requests SET state = 'approved' WHERE id = ${rows[0]?.id}`.execute(
          trx,
        );
      };
      await approve('update', 'name', '"Persona Revisora Renombrada"');
      await sql`RESET ROLE`.execute(trx);
      await asPublic(trx);
      const renamed = await createElectionSource(trx)('test-a', LIVE_A.slug);
      expect(
        renamed?.changes?.find((change) => change.targetKind === 'methodology_reviewer'),
      ).toMatchObject({
        targetKind: 'methodology_reviewer',
        field: 'name',
        // Named as the methodology names them now, never by the names before or after.
        target: 'Persona Revisora Renombrada',
        previousValue: null,
        newValue: null,
      });
      await approve('retire', null, null);
      await sql`RESET ROLE`.execute(trx);
      await asPublic(trx);
      const retired = await createElectionSource(trx)('test-a', LIVE_A.slug);
      expect(JSON.stringify(retired?.changes)).not.toContain('Persona Revisora');
      // Both approvals share their transaction's instant: found by what they did, not their order.
      expect(retired?.changes?.find((change) => change.action === 'retire')).toMatchObject({
        target: null,
      });
    });
  });

  it("names a set's fields (PLAN R183), with their values, and a reviewer's set by its fields alone", async () => {
    await inRolledBackTransaction(async (trx) => {
      const [party] = ELECTIONS_A.live.parties;
      const as = async (user: string) => {
        await sql`RESET ROLE`.execute(trx);
        await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
          trx,
        );
        await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
      };
      const approve = async (kind: string, target: string | undefined, values: unknown) => {
        await as(USERS.editorA);
        const { rows } = await sql<{ id: string }>`
          INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                           proposed_value, public_note)
          VALUES (${TENANT_A}, ${LIVE_A.id}, 'update', ${kind}, ${target}, NULL, ${JSON.stringify(values)}::jsonb,
                  '{"es": "Una nota pública inventada."}')
          RETURNING id`.execute(trx);
        await as(USERS.countryAdminA);
        await sql`UPDATE app.change_requests SET state = 'approved' WHERE id = ${rows[0]?.id}`.execute(
          trx,
        );
      };
      await approve('party', party, {
        website: 'https://ejemplo.test/web-del-conjunto',
        colour: '#0a0b0c',
      });
      await approve('methodology_reviewer', ELECTIONS_A.live.reviewer, {
        name: 'Persona Revisora Inventada',
        affiliation: 'Universidad de ejemplo',
      });
      await sql`RESET ROLE`.execute(trx);
      await asPublic(trx);
      const data = await createElectionSource(trx)('test-a', LIVE_A.slug);
      expect(data?.changes?.find((change) => change.targetKind === 'party')).toMatchObject({
        field: null,
        fields: expect.arrayContaining(['website', 'colour']),
        previousValue: { website: null, colour: null },
        newValue: { website: 'https://ejemplo.test/web-del-conjunto', colour: '#0a0b0c' },
      });
      const reviewer = data?.changes?.find(
        (change) => change.targetKind === 'methodology_reviewer',
      );
      expect(reviewer).toMatchObject({ field: null, previousValue: null, newValue: null });
      expect([...(reviewer?.fields ?? [])].sort()).toEqual(['affiliation', 'name']);
      expect(JSON.stringify(data?.changes)).not.toContain('Universidad de ejemplo');
    });
  });

  it('reads, on its own pool, in one read-only snapshot', async () => {
    const url = process.env.TEST_SUPERUSER_DATABASE_URL;
    if (!url) {
      throw new Error('TEST_SUPERUSER_DATABASE_URL is not set. Copy .env.example to .env.');
    }
    const web = new URL(url);
    web.searchParams.set('options', '-c role=aiontheballot_web');
    // Every statement the pool's clients send, to see how the read begins.
    const sent: string[] = [];
    const pool = new pg.Pool({ connectionString: web.toString(), max: 1 });
    pool.on('connect', (client) => {
      const query = client.query.bind(client) as (...args: unknown[]) => unknown;
      Object.assign(client, {
        query: (...args: unknown[]) => {
          const [text] = args;
          sent.push(typeof text === 'string' ? text : String((text as { text?: unknown }).text));
          return query(...args);
        },
      });
    });
    const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    try {
      const data = await createElectionSource(db)('test-a', LIVE_A.slug);
      expect(data?.cells).toHaveLength(1);
      expect(sent[0]).toMatch(/^start transaction isolation level repeatable read read only$/iu);
      expect(sent.at(-1)).toMatch(/^commit$/iu);
    } finally {
      await db.destroy();
    }
  });

  it("is each tenant's own, though two tenants share an election's slug", async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const b = await createElectionSource(trx)('test-b', LIVE_A.slug);
      expect(b?.parties.length).toBeGreaterThan(0);
      for (const party of b?.parties ?? []) {
        expect(ELECTIONS_A.live.parties).not.toContain(party.id);
      }
    });
  });

  it('serves an archived election too', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(
        (await createElectionSource(trx)('test-a', ELECTIONS_A.archived.slug))?.election.status,
      ).toBe('archived');
    });
  });

  it.each([
    ['an announced draft, whose own row is public', 'test-a', ELECTIONS_A.draft.slug],
    ['an unannounced draft', 'test-a', ELECTIONS_A.empty.slug],
    ['an election that does not exist', 'test-a', 'no-existe'],
    ['an inactive tenant', 'test-inactive', LIVE_A.slug],
  ])('is nothing for %s', async (_name, tenant, election) => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(await createElectionSource(trx)(tenant, election)).toBeUndefined();
    });
  });

  it.each([
    ['a party that left the election', 'parties', 'partyId'],
    ['a retired criterion', 'criteria', 'criterionId'],
  ] as const)(
    'leaves out the cells of %s, as it leaves out the item itself',
    async (_name, table, key) => {
      await inRolledBackTransaction(async (trx) => {
        const [cell] = (await createElectionSource(trx)('test-a', LIVE_A.slug))?.cells ?? [];
        const items = sql.table(`app.${table}`);
        await sql`ALTER TABLE ${items} DISABLE TRIGGER USER`.execute(trx);
        await sql`UPDATE ${items} SET retired_at = now() WHERE id = ${cell?.[key]}`.execute(trx);
        await sql`ALTER TABLE ${items} ENABLE TRIGGER USER`.execute(trx);
        await asPublic(trx);
        const data = await createElectionSource(trx)('test-a', LIVE_A.slug);
        expect(
          [...(data?.parties ?? []), ...(data?.criteria ?? [])].map((item) => item.id),
        ).not.toContain(cell?.[key]);
        expect(data?.cells).toEqual([]);
      });
    },
  );
});

describe('an election in preview (PLAN R181)', () => {
  const preview = ELECTIONS_A.preview;

  it("is served, as live, only by the preview's source and only to the preview's role", async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`UPDATE app.elections SET intro = '{"es": "Una introducción de ejemplo."}' WHERE id = ${preview.id}`.execute(
        trx,
      );
      await sql`SET LOCAL ROLE aiontheballot_preview`.execute(trx);
      const data = await createElectionSource(trx, { preview: true })('test-a', preview.slug);
      expect(data?.election).toMatchObject({
        slug: preview.slug,
        status: 'live',
        intro: { es: 'Una introducción de ejemplo.' },
      });
      expect(data?.parties.map((p) => p.id)).toEqual(preview.parties);
      // Its first party's logo, which the preview's role reads as a previewed party's.
      expect(data?.parties[0]?.logo).toEqual({
        sha256: expect.any(String),
        contentType: 'image/png',
      });
      expect(await createElectionSource(trx)('test-a', preview.slug)).toBeUndefined();
      await sql`RESET ROLE`.execute(trx);
      // The public role reads its announced row, and nothing under it, whatever the source asks.
      await asPublic(trx);
      const asked = await createElectionSource(trx, { preview: true })('test-a', preview.slug);
      expect({
        methodology: asked?.methodology,
        parties: asked?.parties,
        criteria: asked?.criteria,
        cells: asked?.cells,
      }).toEqual({ methodology: null, parties: [], criteria: [], cells: [] });
    });
  });

  it('shows a cell republished in preview as the one version its public will first see', async () => {
    await inRolledBackTransaction(async (trx) => {
      const [party] = preview.parties;
      const [criterion] = preview.criteria;
      // Two revisions published in preview, written directly (the publish flow is packages/db's to test).
      await sql`SET LOCAL session_replication_role = replica`.execute(trx);
      const cell = await sql<{ id: string }>`
        INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, state, generation, updated_by)
        VALUES (${TENANT_A}, ${preview.id}, ${party}, ${criterion}, 'published', 2, ${USERS.editorA})
        RETURNING id`.execute(trx);
      await sql`
        INSERT INTO app.assessment_revisions (tenant_id, assessment_id, election_id, party_id, criterion_id,
                                              reviewed_version, revision_no, rating, summary, change_kind, public_note,
                                              published_in_preview)
        VALUES (${TENANT_A}, ${cell.rows[0]?.id}, ${preview.id}, ${party}, ${criterion}, 0, 1, 'meets',
                '{"es": "Resumen inventado"}', 'initial', NULL, true),
               (${TENANT_A}, ${cell.rows[0]?.id}, ${preview.id}, ${party}, ${criterion}, 1, 2, 'does_not_meet',
                '{"es": "Resumen inventado y revisado"}', 'update', '{"es": "Nota inventada"}', true)`.execute(
        trx,
      );
      await sql`SET LOCAL session_replication_role = origin`.execute(trx);
      await sql`SET LOCAL ROLE aiontheballot_preview`.execute(trx);
      const data = await createElectionSource(trx, { preview: true })('test-a', preview.slug);
      expect(data?.cells).toHaveLength(1);
      expect(data?.cells[0]?.revisions).toEqual([
        expect.objectContaining({
          revisionNo: 1,
          rating: 'does_not_meet',
          summary: { es: 'Resumen inventado y revisado' },
          changeKind: 'initial',
          publicNote: null,
        }),
      ]);
    });
  });
});
