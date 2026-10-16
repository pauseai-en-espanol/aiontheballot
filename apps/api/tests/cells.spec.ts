import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  addCheckedDocument,
  addQuote,
  attachAttestationFile,
  attestQuote,
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
  setQuoteClip,
  sourceUnits,
  withdrawAttestation,
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
      // A's draft election has no cells at all.
      const [party] = ELECTIONS_A.draft.parties;
      const [criterion] = ELECTIONS_A.draft.criteria;
      const id = await createCell(trx, TENANT_A, ELECTIONS_A.draft.id, party, criterion);
      expect((await getCell(trx, ELECTIONS_A.draft.id, party, criterion))?.draft).toMatchObject({
        id,
        state: 'draft',
        rating: null,
        quotes: [],
      });
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

  it('links a report of its election the writer reads (C10.4), checked after the version', async () => {
    await inRolledBackTransaction(async (trx) => {
      const { content_version: version } = await pairOf(trx, LIVE_A.cells.draft);
      // A report about A's archived election, as the owner writes one here.
      const { rows } = await sql<{ id: string }>`
        INSERT INTO app.reports (tenant_id, election_id, kind, message, anonymize_after)
        VALUES (${TENANT_A}, ${ELECTIONS_A.archived.id}, 'error_report', 'Mensaje de ejemplo', current_date + 1)
        RETURNING id`.execute(trx);
      const elsewhere = rows[0]?.id ?? '';
      const { rows: live } = await sql<{ id: string }>`
        SELECT id FROM app.reports WHERE tenant_id = ${TENANT_A} AND election_id = ${LIVE_A.id}`.execute(
        trx,
      );
      const here = live[0]?.id ?? '';
      await actAs(trx, USERS.editorA);
      const fields = {
        rating: 'meets' as const,
        summary: { es: 'Resumen de ejemplo' },
        changeKind: null,
        publicNote: null,
      };
      expect(
        await saveCell(trx, LIVE_A.id, LIVE_A.cells.draft, version, {
          ...fields,
          reportId: elsewhere,
        }),
      ).toBe('not-found');
      // A stale version is said first, whatever the report.
      expect(
        await saveCell(trx, LIVE_A.id, LIVE_A.cells.draft, version - 1, {
          ...fields,
          reportId: elsewhere,
        }),
      ).toBe('stale');
      expect(
        await saveCell(trx, LIVE_A.id, LIVE_A.cells.draft, version, { ...fields, reportId: here }),
      ).toBe('changed');
      const { rows: saved } = await sql<{ draft_report_id: string | null }>`
        SELECT draft_report_id FROM app.assessments WHERE id = ${LIVE_A.cells.draft}`.execute(trx);
      expect(saved[0]?.draft_report_id).toBe(here);
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
      // A step from the wrong state is refused, though the version is right: transitions don't change it.
      expect(
        await moveCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version, 'draft'),
      ).toBe('stale');
      expect(
        await rejectCell(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.inReview,
          pair.content_version,
          'Nota',
        ),
      ).toBe('stale');
      expect(await publishCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version)).toBe(
        'stale',
      );
    });
  });

  it('is not published by someone who worked on it while four-eyes is on (C7.2)', async () => {
    await inRolledBackTransaction(async (trx) => {
      const pair = await pairOf(trx, LIVE_A.cells.inReview);
      // A country admin may both edit and publish: only four-eyes stands in the way of their own work.
      await actAs(trx, USERS.countryAdminA);
      await rejectCell(
        trx,
        TENANT_A,
        LIVE_A.id,
        LIVE_A.cells.inReview,
        pair.content_version,
        'Lo reviso yo',
      );
      await saveCell(trx, LIVE_A.id, LIVE_A.cells.inReview, pair.content_version, {
        rating: LIVE_A.publishedRating,
        summary: { es: 'Resumen de ejemplo de la administración' },
        changeKind: null,
        publicNote: null,
      });
      const { content_version: version } = await pairOf(trx, LIVE_A.cells.inReview);
      await moveCell(trx, LIVE_A.id, LIVE_A.cells.inReview, version, 'in_review');
      await expect(
        publishCell(trx, LIVE_A.id, LIVE_A.cells.inReview, version),
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

  it('keeps a cell never published once it has a trail (C13.2)', async () => {
    await as(USERS.editorA, async (trx) => {
      const [party] = ELECTIONS_A.draft.parties;
      const [criterion] = ELECTIONS_A.draft.criteria;
      const id = await createCell(trx, TENANT_A, ELECTIONS_A.draft.id, party, criterion);
      await commentOnCell(trx, TENANT_A, ELECTIONS_A.draft.id, id, 'Un comentario de ejemplo');
      await expect(deleteCell(trx, ELECTIONS_A.draft.id, id, 0)).rejects.toMatchObject({
        code: '23503',
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
      const found = await sourceUnits(trx, LIVE_A.id, SOURCE_A);
      expect(found?.final).toBe(true);
      expect(found?.units.map(({ index, label }) => ({ index, label }))).toEqual([
        { index: 1, label: 'p. 1' },
        { index: 2, label: 'p. 2' },
      ]);
    });
  });
});

describe('attested quotes (C4)', () => {
  /** The SQLSTATE a write is refused with, or null. */
  const refusal = (write: Promise<unknown>) =>
    write.then(
      () => null,
      (error: unknown) => (error as { code?: string }).code ?? 'no code',
    );

  /**
   * A source without text in one of A's elections (the live one by default), as an upload by the country admin and its
   * extraction leave it, of `kind` (admitted for quotes, which a live election's methodology must already do); then back
   * to acting as `actor`.
   */
  const scanned = async (
    trx: Transaction<DB>,
    actor: string,
    kind = 'pdf',
    election: string = LIVE_A.id,
  ): Promise<string> => {
    await sql`RESET ROLE`.execute(trx);
    await sql`SELECT set_config('app.user_id', ${USERS.countryAdminA}, true)`.execute(trx);
    const content = `escaneo de ejemplo ${crypto.randomUUID()}`;
    const { rows: files } = await sql<{ id: string }>`
      INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
      VALUES (${TENANT_A}, 'sources', 'application/pdf', octet_length(convert_to(${content}, 'UTF8')),
              encode(sha256(convert_to(${content}, 'UTF8')), 'hex'), 'escaneo.pdf')
      RETURNING id`.execute(trx);
    const { rows: sources } = await sql<{ id: string }>`
      INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
      VALUES (${TENANT_A}, ${election}, ${kind}, 'Documento escaneado de ejemplo') RETURNING id`.execute(
      trx,
    );
    const id = sources[0]?.id ?? '';
    await sql`UPDATE app.source_documents SET file_id = ${files[0]?.id ?? null}, file_origin = 'uploaded'
               WHERE id = ${id}`.execute(trx);
    await sql`UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = ${id}`.execute(
      trx,
    );
    await sql`UPDATE app.methodologies SET admissible_source_kinds = admissible_source_kinds || ${kind}::app.source_kind
               WHERE election_id = ${election} AND NOT ${kind}::app.source_kind = ANY (admissible_source_kinds)`.execute(
      trx,
    );
    await actAs(trx, actor);
    return id;
  };

  const SCREENSHOT = {
    sha256: 'a'.repeat(64),
    byteSize: 2048,
    contentType: 'image/png',
    filename: 'captura.png',
  };
  const SCANNED_QUOTE = 'Una frase escaneada de ejemplo del programa';

  /** Editor A's quote from a scanned source on A's draft cell, with a screenshot attached: the quote and the version. */
  const attestable = async (trx: Transaction<DB>) => {
    const pair = await pairOf(trx, LIVE_A.cells.draft);
    await actAs(trx, USERS.editorA);
    const source = await scanned(trx, USERS.editorA);
    expect(
      await addQuote(trx, TENANT_A, LIVE_A.id, LIVE_A.cells.draft, pair.content_version, {
        sourceId: source,
        text: SCANNED_QUOTE,
        sectionLabel: 'Página 3',
      }),
    ).toBe('changed');
    let cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
    const quote = cell?.draft?.quotes.at(-1);
    expect(quote).toMatchObject({
      matchStatus: 'unmatched',
      withText: false,
      attestationFile: null,
      createdBy: USERS.editorA,
    });
    expect(
      await attachAttestationFile(
        trx,
        TENANT_A,
        LIVE_A.id,
        LIVE_A.cells.draft,
        cell?.draft?.contentVersion ?? -1,
        quote?.id ?? '',
        SCREENSHOT,
      ),
    ).toBe('changed');
    cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
    return { pair, quote: quote?.id ?? '', version: cell?.draft?.contentVersion ?? -1, cell };
  };

  it('attaches a screenshot at the version loaded, keeps the same bytes once, and refuses them as another type', async () => {
    await inRolledBackTransaction(async (trx) => {
      const { quote, version, cell } = await attestable(trx);
      expect(cell?.draft?.quotes.find((q) => q.id === quote)?.attestationFile).toEqual({
        contentType: 'image/png',
        byteSize: 2048,
      });
      // Storing it counts as a contribution, as four-eyes counts them.
      expect(cell?.draft?.uploaders).toContain(USERS.editorA);
      expect(cell?.draft?.contributors).toContain(USERS.editorA);
      const again = { ...SCREENSHOT, filename: 'otra.png' };
      expect(
        await attachAttestationFile(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.draft,
          version - 1,
          quote,
          again,
        ),
      ).toBe('stale');
      expect(
        await attachAttestationFile(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.draft,
          version,
          quote,
          again,
        ),
      ).toBe('changed');
      const { rows } = await sql<{ files: number }>`
        SELECT count(*)::int AS files FROM app.files WHERE sha256 = ${SCREENSHOT.sha256}`.execute(
        trx,
      );
      expect(rows[0]?.files).toBe(1);
      // The same bytes again are no change of content: the version stays.
      expect((await pairOf(trx, LIVE_A.cells.draft)).content_version).toBe(version);
      expect(
        await attachAttestationFile(trx, TENANT_A, LIVE_A.id, LIVE_A.cells.draft, version, quote, {
          ...SCREENSHOT,
          contentType: 'video/mp4',
        }),
      ).toBe('otherType');
      expect(
        await attachAttestationFile(
          trx,
          TENANT_A,
          LIVE_A.id,
          LIVE_A.cells.draft,
          version,
          LIVE_A.cells.draft,
          SCREENSHOT,
        ),
      ).toBe('not-found');
    });
  });

  it('is attested by a member who wrote and stored none of it, at the version they saw, and withdrawn', async () => {
    await inRolledBackTransaction(async (trx) => {
      const { pair, quote, version } = await attestable(trx);
      await actAs(trx, USERS.reviewerA);
      expect(
        await attestQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version - 1, quote, USERS.reviewerA),
      ).toBe('stale');
      expect(
        await attestQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version, quote, USERS.reviewerA),
      ).toBe('changed');
      let cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft?.quotes.find((q) => q.id === quote)).toMatchObject({
        matchStatus: 'attested',
        attestedBy: USERS.reviewerA,
      });
      // Attesting is no change of content.
      expect(cell?.draft?.contentVersion).toBe(version);
      expect(await withdrawAttestation(trx, LIVE_A.id, LIVE_A.cells.draft, quote)).toBe('changed');
      expect(await withdrawAttestation(trx, LIVE_A.id, LIVE_A.cells.draft, quote)).toBe(
        'not-found',
      );
      cell = await getCell(trx, LIVE_A.id, pair.party_id, pair.criterion_id);
      expect(cell?.draft?.quotes.find((q) => q.id === quote)).toMatchObject({
        matchStatus: 'unmatched',
        attestedBy: null,
      });
    });
  });

  it('leaves refusing whoever wrote or stored any of it to the database', async () => {
    await inRolledBackTransaction(async (trx) => {
      const { quote, version } = await attestable(trx);
      expect(
        await refusal(
          attestQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version, quote, USERS.editorA),
        ),
      ).toBe('42501');
    });
    await inRolledBackTransaction(async (trx) => {
      const { quote, version } = await attestable(trx);
      // The country admin stored the scanned copy the quote cites.
      await actAs(trx, USERS.countryAdminA);
      expect(
        await refusal(
          attestQuote(trx, LIVE_A.id, LIVE_A.cells.draft, version, quote, USERS.countryAdminA),
        ),
      ).toBe('42501');
    });
  });

  it('records where in a clip a quote is said, which the database keeps in order', async () => {
    // In A's draft election, whose methodology may still admit video.
    const draft = ELECTIONS_A.draft;
    await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      const source = await scanned(trx, USERS.editorA, 'video', draft.id);
      const cellId = await createCell(trx, TENANT_A, draft.id, draft.parties[0], draft.criteria[0]);
      expect(
        await addQuote(trx, TENANT_A, draft.id, cellId, 0, {
          sourceId: source,
          text: SCANNED_QUOTE,
          sectionLabel: null,
        }),
      ).toBe('changed');
      let cell = await getCell(trx, draft.id, draft.parties[0], draft.criteria[0]);
      const quote = cell?.draft?.quotes.at(-1)?.id ?? '';
      const version = cell?.draft?.contentVersion ?? -1;
      expect(
        await setQuoteClip(trx, draft.id, cellId, version, quote, { start: 12.5, end: 20 }),
      ).toBe('changed');
      cell = await getCell(trx, draft.id, draft.parties[0], draft.criteria[0]);
      expect(cell?.draft?.quotes.find((q) => q.id === quote)?.clip).toEqual({
        start: 12.5,
        end: 20,
      });
      expect(
        await refusal(
          setQuoteClip(trx, draft.id, cellId, version + 1, quote, { start: 20, end: 10 }),
        ),
      ).toBe('23514');
    });
  });
});
