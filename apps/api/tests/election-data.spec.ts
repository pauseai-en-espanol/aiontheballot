import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
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
      // Only a source's public columns: nothing of its stored copy but the hash.
      for (const item of cell?.revisions[0]?.evidence ?? []) {
        expect(Object.keys(item.source).sort()).toEqual(
          ['archiveUrl', 'kind', 'retrievedAt', 'sha256', 'title', 'url'].sort(),
        );
      }
    });
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
});
