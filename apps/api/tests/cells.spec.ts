import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  addCheckedDocument,
  addQuote,
  clearRecheck,
  commentOnCell,
  createCell,
  deleteCell,
  getCell,
  moveCell,
  publishCell,
  rejectCell,
  removeCheckedDocument,
  removeQuote,
  saveCell,
  sourceUnits,
} from '../src/admin/cells.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, LIVE_A, LIVE_B, TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it; the deferred checks run at once. */
const actAs = async (trx: Transaction<DB>, userId: string) => {
  await sql`SET CONSTRAINTS ALL IMMEDIATE`.execute(trx);
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

const as = <T>(userId: string, fn: (trx: Transaction<DB>) => Promise<T>) =>
  inRolledBackTransaction(async (trx) => {
    await actAs(trx, userId);
    return fn(trx);
  });

/** The fixture source with a stored, extracted copy in A's live election: its first party's. */
const SOURCE_A = '0190f8c4-0000-7000-8000-000000000651';
/** Words from its first page, long enough to cite. */
const QUOTE = 'propone una moratoria de ejemplo sobre los sistemas de prueba';

/** A cell's party and criterion, as the owner sees them. */
const pairOf = async (trx: Transaction<DB>, cellId: string) => {
  const { rows } = await sql<{ party_id: string; criterion_id: string; content_version: number }>`
    SELECT party_id, criterion_id, content_version FROM app.assessments WHERE id = ${cellId}`.execute(
    trx,
  );
  const [row] = rows;
  if (!row) {
    throw new Error(`No cell ${cellId}`);
  }
  return row;
};

describe('a cell (editorial workflow §8)', () => {
  it('shows its draft, its quotes and where they match, and the sources it may cite', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft).toMatchObject({
        id: LIVE_A.cells.draft,
        state: 'draft',
        contentVersion: pair.content_version,
      });
      expect(cell?.draft?.quotes.length).toBeGreaterThan(0);
      expect(cell?.sources.find(({ id }) => id === SOURCE_A)).toMatchObject({
        citable: true,
        admittedForQuotes: true,
      });
    });
  });

  it('shows a published cell with its revisions, newest first', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.published);
      await actAs(trx, USERS.reviewerA);
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.revisions[0]).toMatchObject({ revisionNo: 1, changeKind: 'initial' });
    });
  });

  it("is nobody's but its tenant's members'", async () => {
    await inRolledBackTransaction(async (trx) => {
      const { rows } = await sql<{ party_id: string; criterion_id: string }>`
        SELECT party_id, criterion_id FROM app.assessments WHERE election_id = ${LIVE_B.id} LIMIT 1`.execute(
        trx,
      );
      await actAs(trx, USERS.editorA);
      expect(
        await getCell(trx, LIVE_B.id, rows[0]?.party_id ?? '', rows[0]?.criterion_id ?? ''),
      ).toBe(undefined);
      expect(await sourceUnits(trx, LIVE_B.id, SOURCE_A)).toBeUndefined();
    });
  });

  it('is created as an empty draft, once per party and criterion', async () => {
    await as(USERS.editorA, async (trx) => {
      const [party] = ELECTIONS_A.live.parties;
      const [, criterion] = ELECTIONS_A.live.criteria;
      const taken = await sql<{ n: number }>`
        SELECT count(*)::int AS n FROM app.assessments
         WHERE party_id = ${party} AND criterion_id = ${criterion}`.execute(trx);
      if (taken.rows[0]?.n === 0) {
        const id = await createCell(trx, TENANT_A, LIVE_A.id, party, criterion);
        expect((await getCell(trx, LIVE_A.id, party, criterion))?.draft).toMatchObject({
          id,
          state: 'draft',
          rating: null,
          quotes: [],
        });
      }
      const pair = await pairOf(trx, LIVE_A.cells.draft);
      await expect(
        createCell(trx, TENANT_A, LIVE_A.id, pair.party_id, pair.criterion_id),
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});

describe('editing a draft (C2, C14)', () => {
  it("saves at the version loaded, and refuses one someone else's change made stale", async () => {
    await inRolledBackTransaction(async (trx) => {
      const { content_version: version } = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      const fields = {
        rating: 'meets' as const,
        summary: { es: 'Resumen de ejemplo cambiado' },
        changeKind: null,
        publicNote: null,
      };
      expect(await saveCell(trx, LIVE_A.id, LIVE_A.cells.draft, version, fields)).toBe('changed');
      expect(await saveCell(trx, LIVE_A.id, LIVE_A.cells.draft, version, fields)).toBe('stale');
      expect(await saveCell(trx, LIVE_B.id, LIVE_A.cells.draft, version + 1, fields)).toBe(
        'not-found',
      );
    });
  });

  it('adds a quote the database matches, says on which page, and removes it', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      expect(
        await addQuote(trx, TENANT_A, LIVE_A.id, LIVE_A.cells.draft, pair.content_version, {
          sourceId: SOURCE_A,
          text: `  ${QUOTE}  `,
          sectionLabel: null,
        }),
      ).toBe('changed');
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      const added = cell?.draft?.quotes.at(-1);
      expect(added).toMatchObject({ matchStatus: 'matched', location: 'p. 1' });
      expect(
        await removeQuote(
          trx,
          LIVE_A.id,
          LIVE_A.cells.draft,
          pair.content_version,
          added?.id ?? '',
        ),
      ).toBe('stale');
      const version = cell?.draft?.contentVersion ?? -1;
      expect(await removeQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version, added?.id ?? '')).toBe(
        'changed',
      );
      expect(
        await removeQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version + 1, added?.id ?? ''),
      ).toBe('not-found');
    });
  });

  it('keeps a quote that matches nothing, unmatched, which can then not be submitted', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      await addQuote(trx, TENANT_A, LIVE_A.id, LIVE_A.cells.draft, pair.content_version, {
        sourceId: SOURCE_A,
        text: 'una frase inventada que no está en la fuente',
        sectionLabel: 'p. 99',
      });
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft?.quotes.at(-1)).toMatchObject({
        matchStatus: 'unmatched',
        location: null,
      });
      await expect(
        moveCell(
          trx,
          LIVE_A.id,
          LIVE_A.cells.draft,
          cell?.draft?.contentVersion ?? -1,
          'in_review',
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it('records a checked document, which only a party document of an admitted kind can be', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.draft);
      await actAs(trx, USERS.editorA);
      const before = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      const checkable = before?.sources.find((s) => s.admittedForChecks && s.citable);
      expect(checkable).toBeDefined();
      const id = checkable?.id ?? '';
      // Checking it again is removing it and adding it (C3.2), each a change of its own.
      let version = pair.content_version;
      if (before?.draft?.checkedDocuments.some((c) => c.source.id === id)) {
        expect(await removeCheckedDocument(trx, LIVE_A.id, LIVE_A.cells.draft, version, id)).toBe(
          'changed',
        );
        version += 1;
      }
      expect(
        await addCheckedDocument(trx, TENANT_A, LIVE_A.id, LIVE_A.cells.draft, version, id),
      ).toBe('changed');
      const after = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(after?.draft?.checkedDocuments.map((c) => c.source.id)).toContain(id);
      expect(after?.draft?.checkedDocuments.find((c) => c.source.id === id)?.checkedBy).toBe(
        USERS.editorA,
      );
      expect(before?.sources.find((s) => s.partyId === null)?.admittedForChecks).toBe(false);
    });
  });
});

describe('the workflow (C5–C9, C12, C13)', () => {
  it('is rejected with a note by a reviewer, back to draft, the note in its trail', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.inReview);
      await actAs(trx, USERS.reviewerA);
      expect(
        await rejectCell(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.inReview,
          pair.content_version,
          'Falta una cita del programa',
        ),
      ).toBe('changed');
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft?.state).toBe('draft');
      expect(cell?.draft?.events.at(-1)).toMatchObject({
        kind: 'rejected',
        actorId: USERS.reviewerA,
        note: 'Falta una cita del programa',
      });
    });
  });

  it('is recalled by its editor, and published by a reviewer at the version they saw', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.inReview);
      await actAs(trx, USERS.reviewerA);
      expect(
        await publishCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version + 1),
      ).toBe('stale');
      expect(await publishCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version)).toBe(
        'changed',
      );
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft?.state).toBe('published');
      expect(cell?.revisions).toHaveLength(1);
    });
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.inReview);
      await actAs(trx, USERS.editorA);
      expect(
        await moveCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version, 'draft'),
      ).toBe('changed');
      // Its editor can't publish their own work while four-eyes is on (C7.2).
      await moveCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version, 'in_review');
      await expect(
        publishCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('takes comments from any member, and its recheck flag is cleared without a new version', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.published);
      // As the owner, with an editor's name on it: what the programme trigger does when a programme appears.
      await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true), set_config('app.aal', '2', true)`.execute(
        trx,
      );
      await sql`UPDATE app.assessments SET recheck_reason = 'programme_published' WHERE id = ${LIVE_A.cells.published}`.execute(
        trx,
      );
      await actAs(trx, USERS.reviewerA);
      expect(
        await commentOnCell(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.published,
          'Comentario de ejemplo',
        ),
      ).toBe('changed');
      await actAs(trx, USERS.editorA);
      expect(await clearRecheck(trx, LIVE_A.id, LIVE_A.cells.published)).toBe('changed');
      const cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft).toMatchObject({
        recheckReason: null,
        contentVersion: pair.content_version,
      });
      expect(cell?.draft?.events.at(-1)).toMatchObject({
        kind: 'commented',
        actorId: USERS.reviewerA,
        note: 'Comentario de ejemplo',
      });
    });
  });

  it('deletes a cell never published, and keeps one with a trail', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.published);
      await actAs(trx, USERS.editorA);
      expect(await deleteCell(trx, LIVE_A.id, LIVE_A.cells.published, pair.content_version)).toBe(
        'forbidden',
      );
      expect(
        (await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id))?.draft?.quotes,
      ).not.toEqual([]);
    });
    await as(USERS.editorA, async (trx) => {
      const [party] = ELECTIONS_A.draft.parties;
      const [criterion] = ELECTIONS_A.draft.criteria;
      const id = await createCell(trx, TENANT_A, ELECTIONS_A.draft.id, party, criterion);
      expect(await deleteCell(trx, ELECTIONS_A.draft.id, id, 0)).toBe('changed');
      expect(await getCell(trx, ELECTIONS_A.draft.id, party, criterion)).toMatchObject({
        draft: null,
      });
    });
  });

  it("reads a source's units for the live match, in order", async () => {
    await as(USERS.editorA, async (trx) => {
      const units = await sourceUnits(trx, LIVE_A.id, SOURCE_A);
      expect(units?.map(({ index, label }) => ({ index, label }))).toEqual([
        { index: 1, label: 'p. 1' },
        { index: 2, label: 'p. 2' },
      ]);
    });
  });
});
