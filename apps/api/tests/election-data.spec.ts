import type { DB } from '@aiontheballot/db/generated/db';

import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { createElectionSource } from '../src/election-data.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A } from './fixtures.js';

const asPublic = (trx: Transaction<DB>) => sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);

describe('a public election', () => {
  it('holds its parties, criteria and methodology, and every published revision of its cells', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const data = await createElectionSource(trx)('test-a', LIVE_A.slug);
      expect(data?.election).toMatchObject({ slug: LIVE_A.slug, status: 'live' });
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
