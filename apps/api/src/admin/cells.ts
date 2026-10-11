import type { DB } from '@aiontheballot/db/generated/db';
import type { Rating } from '@aiontheballot/domain/methodology';
import type { SourceUnit } from '@aiontheballot/domain/quote-match';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

/**
 * A cell's working copy and its workflow (editorial workflow §8, C2–C14), read and written in the caller's `withActor`
 * transaction. The database decides everything that matters (ADR-0002, data rules): who may write, the scale, the
 * evidence a rating needs, the verbatim match, four-eyes and every transition. These functions only say what to write;
 * a refusal comes back as the database's error, which the routes turn into answers (§2.3).
 *
 * Every change names the content version the editor loaded (C14): if someone changed the cell since, nothing is
 * written and the answer is `stale`, so the screen can offer to reload.
 */

export type CellState = 'draft' | 'in_review' | 'published';
export type ChangeKind = 'initial' | 'update' | 'correction' | 'withdrawal';
export type ReviewEventKind = 'submitted' | 'recalled' | 'approved' | 'rejected' | 'commented';

export interface CellSource {
  id: string;
  title: string;
  kind: string;
}

export interface CellQuote {
  id: string;
  ordinal: number;
  quote: string;
  sectionLabel: string | null;
  source: CellSource;
  matchStatus: 'unmatched' | 'matched' | 'attested';
  /** The matched units' labels, as the public would see them: `p. 47` or `p. 47–p. 48`. */
  location: string | null;
}

export interface CellCheckedDocument {
  source: CellSource;
  checkedAt: string;
  checkedBy: string;
}

export interface CellEvent {
  kind: ReviewEventKind;
  actorId: string;
  note: string | null;
  createdAt: string;
}

export interface CellRevision {
  revisionNo: number;
  rating: Rating | null;
  summary: Localized | null;
  changeKind: ChangeKind;
  publicNote: Localized | null;
  publishedAt: string;
}

export interface CellDraft {
  id: string;
  state: CellState;
  generation: number;
  contentVersion: number;
  rating: Rating | null;
  summary: Localized | null;
  changeKind: ChangeKind | null;
  publicNote: Localized | null;
  recheckReason: string | null;
  quotes: CellQuote[];
  checkedDocuments: CellCheckedDocument[];
  events: CellEvent[];
  /** Who has worked on the current draft (its generation): they can't publish it while four-eyes is on (C7.2). */
  contributors: string[];
}

/** A source the cell may cite or check: the party's own, or a party-neutral one, in the cell's election. */
export interface CitableSource extends CellSource {
  partyId: string | null;
  isProgramme: boolean;
  /** It has a stored copy and its extraction is done or not applicable (S3.4). */
  citable: boolean;
  /** The methodology admits its kind for quotes, and for "No lo menciona" (C2.4, C3.1). */
  admittedForQuotes: boolean;
  admittedForChecks: boolean;
}

export interface Cell {
  party: { id: string; slug: string; name: Localized; shortName: Localized; retired: boolean };
  criterion: {
    id: string;
    slug: string;
    title: Localized;
    shortTitle: Localized | null;
    retired: boolean;
  };
  /** Whether the election asks for a second person to publish (four-eyes, P1). */
  requireSecondReviewer: boolean;
  /** None until someone creates the cell. */
  draft: CellDraft | null;
  /** Every published revision, newest first. */
  revisions: CellRevision[];
  sources: CitableSource[];
}

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const optionalLocalized = (value: unknown, column: string): Localized | null =>
  value === null ? null : localized(value, column);

/** An instant as text: node-postgres would make a Date of it, which the JSON answer turns back into text anyway. */
const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

/**
 * A cell by its party and criterion, with everything its screen shows (C2–C12), or undefined if RLS hides the
 * election, party or criterion. The draft is null until the cell is created.
 */
export const getCell = async (
  trx: Transaction<DB>,
  electionId: string,
  partyId: string,
  criterionId: string,
): Promise<Cell | undefined> => {
  const [party, criterion, election] = await Promise.all([
    trx
      .selectFrom('app.parties')
      .select(['id', 'slug', 'name', 'short_name', 'retired_at'])
      .where('election_id', '=', electionId)
      .where('id', '=', partyId)
      .executeTakeFirst(),
    trx
      .selectFrom('app.criteria')
      .select(['id', 'slug', 'title', 'short_title', 'retired_at'])
      .where('election_id', '=', electionId)
      .where('id', '=', criterionId)
      .executeTakeFirst(),
    trx
      .selectFrom('app.elections as e')
      .leftJoin('app.methodologies as m', 'm.election_id', 'e.id')
      .select([
        'e.require_second_reviewer',
        sql<string[] | null>`m.admissible_source_kinds::text[]`.as('admissible'),
        sql<string[] | null>`m.not_mentioned_source_kinds::text[]`.as('not_mentioned'),
      ])
      .where('e.id', '=', electionId)
      .executeTakeFirst(),
  ]);
  if (!party || !criterion || !election) {
    return undefined;
  }
  const assessment = await trx
    .selectFrom('app.assessments')
    .select([
      'id',
      'state',
      'generation',
      'content_version',
      'draft_rating',
      'draft_summary',
      'draft_change_kind',
      'draft_public_note',
      'recheck_reason',
    ])
    .where('election_id', '=', electionId)
    .where('party_id', '=', partyId)
    .where('criterion_id', '=', criterionId)
    .executeTakeFirst();
  const sources = await trx
    .selectFrom('app.source_documents')
    .select(['id', 'title', 'kind', 'party_id', 'is_programme', 'file_id', 'extraction_status'])
    .where('election_id', '=', electionId)
    .where((eb) => eb.or([eb('party_id', '=', partyId), eb('party_id', 'is', null)]))
    .orderBy('is_programme', 'desc')
    .orderBy('title')
    .execute();
  const admissible = election.admissible ?? [];
  const notMentioned = election.not_mentioned ?? [];
  const citable = sources.map((s): CitableSource => ({
    id: s.id,
    title: s.title,
    kind: s.kind,
    partyId: s.party_id,
    isProgramme: s.is_programme,
    citable:
      s.file_id !== null &&
      (s.extraction_status === 'done' || s.extraction_status === 'not_applicable'),
    admittedForQuotes: admissible.includes(s.kind),
    admittedForChecks: s.party_id === partyId && notMentioned.includes(s.kind),
  }));
  const revisions = assessment
    ? await trx
        .selectFrom('app.assessment_revisions')
        .select([
          'revision_no',
          'rating',
          'summary',
          'change_kind',
          'public_note',
          instant('published_at').as('published_at'),
        ])
        .where('assessment_id', '=', assessment.id)
        .orderBy('revision_no', 'desc')
        .execute()
    : [];
  return {
    party: {
      id: party.id,
      slug: party.slug,
      name: localized(party.name, 'parties.name'),
      shortName: localized(party.short_name, 'parties.short_name'),
      retired: party.retired_at !== null,
    },
    criterion: {
      id: criterion.id,
      slug: criterion.slug,
      title: localized(criterion.title, 'criteria.title'),
      shortTitle: optionalLocalized(criterion.short_title, 'criteria.short_title'),
      retired: criterion.retired_at !== null,
    },
    requireSecondReviewer: election.require_second_reviewer,
    draft: assessment ? await draftOf(trx, assessment) : null,
    revisions: revisions.map((r) => ({
      revisionNo: r.revision_no,
      rating: r.rating,
      summary: optionalLocalized(r.summary, 'assessment_revisions.summary'),
      changeKind: r.change_kind,
      publicNote: optionalLocalized(r.public_note, 'assessment_revisions.public_note'),
      publishedAt: r.published_at,
    })),
    sources: citable,
  };
};

const draftOf = async (
  trx: Transaction<DB>,
  assessment: {
    id: string;
    state: CellState;
    generation: number;
    content_version: number;
    draft_rating: Rating | null;
    draft_summary: unknown;
    draft_change_kind: ChangeKind | null;
    draft_public_note: unknown;
    recheck_reason: string | null;
  },
): Promise<CellDraft> => {
  const [quotes, checked, events, contributors] = await Promise.all([
    trx
      .selectFrom('app.draft_evidence as v')
      .innerJoin('app.source_documents as s', 's.id', 'v.source_document_id')
      .select([
        'v.id',
        'v.ordinal',
        'v.quote',
        'v.section_label',
        'v.match_status',
        's.id as source_id',
        's.title',
        's.kind',
        // The labels the public would see: the first matched unit's, then the last one's if it differs.
        sql<string | null>`(
          SELECT string_agg(t.label, '–' ORDER BY t.unit_index)
            FROM app.source_texts t
           WHERE t.source_document_id = v.source_document_id
             AND t.unit_index IN (v.matched_from_unit, v.matched_to_unit)
        )`.as('location'),
      ])
      .where('v.assessment_id', '=', assessment.id)
      .orderBy('v.ordinal')
      .execute(),
    trx
      .selectFrom('app.draft_checked_documents as c')
      .innerJoin('app.source_documents as s', 's.id', 'c.source_document_id')
      .select([
        's.id as source_id',
        's.title',
        's.kind',
        instant('c.checked_at').as('checked_at'),
        'c.checked_by',
      ])
      .where('c.assessment_id', '=', assessment.id)
      .orderBy('s.title')
      .execute(),
    trx
      .selectFrom('app.review_events')
      .select(['kind', 'actor_id', 'note', instant('created_at').as('created_at')])
      .where('assessment_id', '=', assessment.id)
      .orderBy('created_at')
      .orderBy(sql`id`)
      .execute(),
    trx
      .selectFrom('app.assessment_contributors')
      .select('user_id')
      .where('assessment_id', '=', assessment.id)
      .where('generation', '=', assessment.generation)
      .orderBy('user_id')
      .execute(),
  ]);
  return {
    id: assessment.id,
    state: assessment.state,
    generation: assessment.generation,
    contentVersion: assessment.content_version,
    rating: assessment.draft_rating,
    summary: optionalLocalized(assessment.draft_summary, 'assessments.draft_summary'),
    changeKind: assessment.draft_change_kind,
    publicNote: optionalLocalized(assessment.draft_public_note, 'assessments.draft_public_note'),
    recheckReason: assessment.recheck_reason,
    quotes: quotes.map((q) => ({
      id: q.id,
      ordinal: q.ordinal,
      quote: q.quote,
      sectionLabel: q.section_label,
      source: { id: q.source_id, title: q.title, kind: q.kind },
      matchStatus: q.match_status,
      location: q.match_status === 'matched' ? q.location : null,
    })),
    checkedDocuments: checked.map((c) => ({
      source: { id: c.source_id, title: c.title, kind: c.kind },
      checkedAt: c.checked_at,
      checkedBy: c.checked_by,
    })),
    events: events.map((e) => ({
      kind: e.kind,
      actorId: e.actor_id,
      note: e.note,
      createdAt: e.created_at,
    })),
    contributors: contributors.map((c) => c.user_id),
  };
};

/**
 * The outcome of a change: done, the cell (or what it names) isn't there, someone changed it first (C14), or RLS
 * leaves the actor nothing to change (a published cell can't be deleted).
 */
export type CellChange = 'changed' | 'not-found' | 'stale' | 'forbidden';

/**
 * Locks the cell and checks it is still the version the editor loaded. Locking first makes the check and the write
 * one step: nobody else can change the cell in between.
 */
const lockedAt = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
): Promise<CellChange> => {
  const row = await trx
    .selectFrom('app.assessments')
    .select('content_version')
    .where('election_id', '=', electionId)
    .where('id', '=', cellId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) {
    return 'not-found';
  }
  return row.content_version === version ? 'changed' : 'stale';
};

/**
 * Creates a party × criterion cell as a draft (C2.1); its id. The database refuses a second one for the pair. These
 * inserts are plain SQL: the database stamps who wrote each row (`updated_by`, `created_by`…) from the actor, which
 * the generated types count as columns to give.
 */
export const createCell = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  partyId: string,
  criterionId: string,
): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id)
    VALUES (${tenantId}, ${electionId}, ${partyId}, ${criterionId})
    RETURNING id`.execute(trx);
  const [row] = rows;
  if (!row) {
    throw new Error('The new cell came back with no id');
  }
  return row.id;
};

export interface CellFields {
  rating: Rating | null;
  summary: Localized | null;
  /** After the first publish only (C10): `update`, `correction` or `withdrawal`. */
  changeKind: ChangeKind | null;
  publicNote: Localized | null;
}

/** Saves the draft's rating, summary, change kind and public note (C2, C10, C11), all at once, as the form holds them. */
export const saveCell = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
  fields: CellFields,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  await trx
    .updateTable('app.assessments')
    .set({
      draft_rating: fields.rating,
      draft_summary: fields.summary === null ? null : JSON.stringify(fields.summary),
      draft_change_kind: fields.changeKind,
      draft_public_note: fields.publicNote === null ? null : JSON.stringify(fields.publicNote),
    })
    .where('id', '=', cellId)
    .execute();
  return 'changed';
};

/** Adds a quote from a source (C2.4–7), after the others; the database matches it and sets its status. */
export const addQuote = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  cellId: string,
  version: number,
  quote: { sourceId: string; text: string; sectionLabel: string | null },
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  const last = await trx
    .selectFrom('app.draft_evidence')
    .select(sql<number>`coalesce(max(ordinal), 0)`.as('ordinal'))
    .where('assessment_id', '=', cellId)
    .executeTakeFirstOrThrow();
  await sql`
    INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                    section_label)
    VALUES (${tenantId}, ${electionId}, ${cellId}, ${quote.sourceId}, ${last.ordinal + 1}, ${quote.text},
            ${quote.sectionLabel})`.execute(trx);
  return 'changed';
};

/** Removes a quote from the draft. */
export const removeQuote = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
  quoteId: string,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  const deleted = await trx
    .deleteFrom('app.draft_evidence')
    .where('assessment_id', '=', cellId)
    .where('id', '=', quoteId)
    .executeTakeFirst();
  return deleted.numDeletedRows > 0n ? 'changed' : 'not-found';
};

/** Records that a party document was checked for "No lo menciona" (C3); the database stamps when. */
export const addCheckedDocument = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  cellId: string,
  version: number,
  sourceId: string,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  await sql`
    INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
    VALUES (${cellId}, ${tenantId}, ${electionId}, ${sourceId})`.execute(trx);
  return 'changed';
};

/** Removes a checked document; checking it again is adding it again (C3.2). */
export const removeCheckedDocument = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
  sourceId: string,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  const deleted = await trx
    .deleteFrom('app.draft_checked_documents')
    .where('assessment_id', '=', cellId)
    .where('source_document_id', '=', sourceId)
    .executeTakeFirst();
  return deleted.numDeletedRows > 0n ? 'changed' : 'not-found';
};

/** Moves the cell between draft and review: submitting (C5) or recalling it (C6). */
export const moveCell = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
  state: 'draft' | 'in_review',
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  await trx.updateTable('app.assessments').set({ state }).where('id', '=', cellId).execute();
  return 'changed';
};

/**
 * Sends a cell in review back to its editors with a note (C8): the note is a comment written in the same transaction,
 * which the trail copies into the "rejected" event.
 */
export const rejectCell = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  cellId: string,
  version: number,
  note: string,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  await comment(trx, tenantId, cellId, note);
  await trx
    .updateTable('app.assessments')
    .set({ state: 'draft' })
    .where('id', '=', cellId)
    .execute();
  return 'changed';
};

/**
 * Publishes the version the reviewer saw (C7): the publish trigger checks everything again, writes the revision and
 * its evidence, and refuses if the draft changed since that version.
 */
export const publishCell = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  await sql`
    INSERT INTO app.assessment_revisions (assessment_id, reviewed_version) VALUES (${cellId}, ${version})`.execute(
    trx,
  );
  return 'changed';
};

const comment = (trx: Transaction<DB>, tenantId: string, cellId: string, note: string) =>
  sql`
    INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
    VALUES (${tenantId}, ${cellId}, 'commented', ${note})`.execute(trx);

/** Adds a comment to a cell (C9): any member, at any time; comments never change. */
export const commentOnCell = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  cellId: string,
  note: string,
): Promise<CellChange> => {
  const cell = await trx
    .selectFrom('app.assessments')
    .select('id')
    .where('election_id', '=', electionId)
    .where('id', '=', cellId)
    .executeTakeFirst();
  if (!cell) {
    return 'not-found';
  }
  await comment(trx, tenantId, cellId, note);
  return 'changed';
};

/** Clears a recheck flag once someone has checked (C12.2): not a content change, so the version stays. */
export const clearRecheck = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
): Promise<CellChange> => {
  const updated = await trx
    .updateTable('app.assessments')
    .set({ recheck_reason: null })
    .where('election_id', '=', electionId)
    .where('id', '=', cellId)
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n ? 'changed' : 'not-found';
};

/**
 * Deletes a cell never published (C13); its quotes and checked documents go with it. RLS gives editors only cells of
 * generation 0, and the database keeps one with a review trail (its events name it).
 */
export const deleteCell = async (
  trx: Transaction<DB>,
  electionId: string,
  cellId: string,
  version: number,
): Promise<CellChange> => {
  const locked = await lockedAt(trx, electionId, cellId, version);
  if (locked !== 'changed') {
    return locked;
  }
  const deleted = await trx
    .deleteFrom('app.assessments')
    .where('id', '=', cellId)
    .executeTakeFirst();
  return deleted.numDeletedRows > 0n ? 'changed' : 'forbidden';
};

/**
 * A source's extracted units, for the live match (C2.6): read under RLS, so a source the actor can't see has none.
 * Undefined if there is no such source in the election.
 */
export const sourceUnits = async (
  trx: Transaction<DB>,
  electionId: string,
  sourceId: string,
): Promise<SourceUnit[] | undefined> => {
  const source = await trx
    .selectFrom('app.source_documents')
    .select('id')
    .where('election_id', '=', electionId)
    .where('id', '=', sourceId)
    .executeTakeFirst();
  if (!source) {
    return undefined;
  }
  const units = await trx
    .selectFrom('app.source_texts')
    .select(['unit_index', 'label', 'body'])
    .where('source_document_id', '=', sourceId)
    .orderBy('unit_index')
    .execute();
  return units.map((u) => ({ index: u.unit_index, label: u.label, body: u.body }));
};
