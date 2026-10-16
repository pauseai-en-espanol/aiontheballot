import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

import type { SourceKind } from './methodology.js';

/**
 * An election's sources (editorial workflow §7, S1–S6), read and written in the caller's `withActor` transaction: RLS
 * decides who may (editors and country admins write; every member reads), and the source rules keep a stored copy
 * from ever changing (S1.2). The bytes go to the file store before their row is written (ADR-0004); this module only
 * writes rows.
 */

export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'not_applicable';

export interface Source {
  id: string;
  title: string;
  kind: SourceKind;
  url: string | null;
  language: string | null;
  partyId: string | null;
  isProgramme: boolean;
  /** The stored copy, once there is one: its hash, size and type, and when it was stored. */
  copy: { sha256: string; byteSize: number; contentType: string; retrievedAt: string } | null;
  extractionStatus: ExtractionStatus;
  archiveUrl: string | null;
  /** The extracted units (pages or sections), once extraction is done. */
  units: number;
  /** Quotes and checked documents that cite it, drafts and published revisions alike: it is deleted only at 0. */
  citations: number;
  /** Whether an extraction job is waiting to be done. */
  extractionRequested: boolean;
  /** Whether an archive job is waiting for its snapshot (S4; ADR-0007 §4). */
  archiveRequested: boolean;
  /** It has a stored copy and its extraction is done or not applicable, so cells may cite it (S3.4). */
  citable: boolean;
  /** When it was marked replaced (PLAN D14): then it takes no new quote or check, and is listed last. */
  replacedAt: string | null;
}

export interface SourceFields {
  title: string;
  kind: SourceKind;
  url: string | null;
  language: string | null;
  partyId: string | null;
  isProgramme: boolean;
}

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

/** Every source of the election RLS shows the actor, programmes first, then by title; or the one with `id`. */
export const listSources = async (
  trx: Transaction<DB>,
  electionId: string,
  id?: string,
): Promise<Source[]> => {
  let query = trx
    .selectFrom('app.source_documents as s')
    .leftJoin('app.files as f', 'f.id', 's.file_id')
    .select([
      's.id',
      's.title',
      's.kind',
      's.url',
      's.language',
      's.party_id',
      's.is_programme',
      's.sha256',
      'f.byte_size',
      'f.content_type',
      instant('s.retrieved_at').as('retrieved_at'),
      's.extraction_status',
      's.archive_url',
      sql<string | null>`to_json(s.replaced_at)#>>'{}'`.as('replaced_at'),
      sql<number>`(SELECT count(*)::int FROM app.source_texts t WHERE t.source_document_id = s.id)`.as(
        'units',
      ),
      sql<number>`(
        (SELECT count(*) FROM app.draft_evidence e WHERE e.source_document_id = s.id)
        + (SELECT count(*) FROM app.revision_evidence e WHERE e.source_document_id = s.id)
        + (SELECT count(*) FROM app.draft_checked_documents c WHERE c.source_document_id = s.id)
        + (SELECT count(*) FROM app.revision_checked_documents c WHERE c.source_document_id = s.id)
      )::int`.as('citations'),
      sql<boolean>`EXISTS (SELECT 1 FROM app.job_requests j
                            WHERE j.source_document_id = s.id AND j.kind = 'extract_source'
                              AND j.finished_at IS NULL)`.as('extraction_requested'),
      sql<boolean>`EXISTS (SELECT 1 FROM app.job_requests j
                            WHERE j.source_document_id = s.id AND j.kind = 'archive_source'
                              AND j.finished_at IS NULL)`.as('archive_requested'),
    ])
    .where('s.election_id', '=', electionId);
  if (id !== undefined) {
    query = query.where('s.id', '=', id);
  }
  // Replaced ones last (PLAN D14), then programmes first, then by title.
  const rows = await query
    .orderBy(sql`s.replaced_at IS NOT NULL`)
    .orderBy('s.is_programme', 'desc')
    .orderBy('s.title')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    url: r.url,
    language: r.language,
    partyId: r.party_id,
    isProgramme: r.is_programme,
    copy:
      r.sha256 !== null && r.byte_size !== null && r.content_type !== null
        ? {
            sha256: r.sha256,
            byteSize: Number(r.byte_size),
            contentType: r.content_type,
            retrievedAt: r.retrieved_at,
          }
        : null,
    extractionStatus: r.extraction_status,
    archiveUrl: r.archive_url,
    units: r.units,
    citations: r.citations,
    extractionRequested: r.extraction_requested,
    archiveRequested: r.archive_requested,
    // A replaced one takes no new quote or check (PLAN D14).
    citable:
      r.replaced_at === null &&
      r.sha256 !== null &&
      (r.extraction_status === 'done' || r.extraction_status === 'not_applicable'),
    replacedAt: r.replaced_at,
  }));
};

/**
 * A new source (S1.1); its id. Plain SQL: the database stamps `created_by`, which the generated types count as a
 * column to give. The checks (an http(s) URL, a programme only of a party) are the database's.
 */
export const createSource = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  fields: SourceFields,
): Promise<string> => {
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, url, language, is_programme)
    VALUES (${tenantId}, ${electionId}, ${fields.partyId}, ${fields.kind}, ${fields.title}, ${fields.url},
            ${fields.language}, ${fields.isProgramme})
    RETURNING id`.execute(trx);
  const [row] = rows;
  if (!row) {
    throw new Error('The new source came back with no id');
  }
  return row.id;
};

/** Changes a source's fields, which the database allows only until it has a stored copy (S1.2). */
export const updateSource = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
  fields: SourceFields,
): Promise<boolean> =>
  (
    await trx
      .updateTable('app.source_documents')
      .set({
        title: fields.title,
        kind: fields.kind,
        url: fields.url,
        language: fields.language,
        party_id: fields.partyId,
        is_programme: fields.isProgramme,
      })
      .where('election_id', '=', electionId)
      .where('id', '=', id)
      .executeTakeFirst()
  ).numUpdatedRows > 0n;

/**
 * Marks a source replaced by a newer version (PLAN D14, R172), its copy stored or not: the database sets the time, once,
 * and keeps it out of new quotes and checks. 'replaced' if it already is, 'not-found' if RLS shows no such source,
 * 'forbidden' if RLS lets the actor read it but not write it (a reviewer).
 */
export const markReplaced = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
): Promise<'marked' | 'replaced' | 'not-found' | 'forbidden'> => {
  const source = await trx
    .selectFrom('app.source_documents')
    .select('replaced_at')
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!source) {
    return 'not-found';
  }
  if (source.replaced_at !== null) {
    return 'replaced';
  }
  const updated = await trx
    .updateTable('app.source_documents')
    .set({ replaced_at: sql`now()` })
    .where('id', '=', id)
    .executeTakeFirst();
  return updated.numUpdatedRows > 0n ? 'marked' : 'forbidden';
};

/** Deletes a source nothing cites (S5.2); the foreign keys refuse one that is cited. */
export const deleteSource = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
): Promise<boolean> =>
  (
    await trx
      .deleteFrom('app.source_documents')
      .where('election_id', '=', electionId)
      .where('id', '=', id)
      .executeTakeFirst()
  ).numDeletedRows > 0n;

/** The source with its copy's place in the file store, for the API to serve its bytes (S6.1). */
export const sourceCopy = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
): Promise<{ tenantId: string; sha256: string; contentType: string } | undefined> => {
  const row = await trx
    .selectFrom('app.source_documents as s')
    .innerJoin('app.files as f', 'f.id', 's.file_id')
    .select(['s.tenant_id', 'f.sha256', 'f.content_type'])
    .where('s.election_id', '=', electionId)
    .where('s.id', '=', id)
    .executeTakeFirst();
  return row
    ? { tenantId: row.tenant_id, sha256: row.sha256, contentType: row.content_type }
    : undefined;
};

/**
 * Whether the source exists in the election and still has no stored copy, checked before an upload is read; and its
 * URL, for a copy fetched from it (S2.1).
 */
export const sourceForUpload = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
): Promise<{ hasCopy: boolean; url: string | null } | undefined> => {
  const row = await trx
    .selectFrom('app.source_documents')
    .select(['file_id', 'url'])
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? { hasCopy: row.file_id !== null, url: row.url } : undefined;
};

/**
 * Attaches an uploaded copy to a source (S2.2), whose bytes the caller stored first: the tenant's file row for the
 * same bytes if one exists (the same bytes are kept once), else a new one; then the source names it (the database sets
 * its hash and time) and an extraction job is requested on behalf of the uploader (S3.1). The source is locked first,
 * so of two uploads at once the second finds the first's copy and is refused (`hasCopy`): a stored copy never
 * changes (S1.2), and a source has one extraction job open at most (a unique index says so too). Bytes the site stored
 * already as another type are refused (`otherType`).
 */
export const attachUpload = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  sourceId: string,
  upload: { sha256: string; byteSize: number; contentType: string; filename: string | null },
  {
    archive = false,
    url,
  }: {
    /** Whether to ask for a snapshot of its URL too (S4). */
    archive?: boolean;
    /** For a copy fetched from the source's URL (S2.1): the URL it came from, which must still be the source's. */
    url?: string;
  } = {},
): Promise<
  { jobId: string; archive?: ArchiveJob } | 'notFound' | 'hasCopy' | 'otherType' | 'urlChanged'
> => {
  const source = await trx
    .selectFrom('app.source_documents')
    .select(['id', 'file_id', 'url'])
    .where('election_id', '=', electionId)
    .where('id', '=', sourceId)
    .forUpdate()
    .executeTakeFirst();
  if (!source) {
    return 'notFound';
  }
  if (source.file_id !== null) {
    return 'hasCopy';
  }
  if (url !== undefined && source.url !== url) {
    return 'urlChanged';
  }
  const existing = await trx
    .selectFrom('app.files')
    .select(['id', 'content_type'])
    .where('tenant_id', '=', tenantId)
    .where('bucket', '=', 'sources')
    .where('sha256', '=', upload.sha256)
    .executeTakeFirst();
  // The same bytes are one file, of one type: uploaded again as another, they would be read and served as the first.
  if (existing && existing.content_type !== upload.contentType) {
    return 'otherType';
  }
  let fileId = existing?.id;
  if (!fileId) {
    const { rows } = await sql<{ id: string }>`
      INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
      VALUES (${tenantId}, 'sources', ${upload.contentType}, ${upload.byteSize}, ${upload.sha256}, ${upload.filename})
      RETURNING id`.execute(trx);
    fileId = rows[0]?.id;
  }
  await trx
    .updateTable('app.source_documents')
    .set({ file_id: fileId ?? null, file_origin: 'uploaded' })
    .where('id', '=', sourceId)
    .execute();
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.job_requests (tenant_id, kind, source_document_id)
    VALUES (${tenantId}, 'extract_source', ${sourceId})
    RETURNING id`.execute(trx);
  const jobId = rows[0]?.id;
  if (!jobId) {
    throw new Error('The extraction job came back with no id');
  }
  // A snapshot of the URL beside the copy (S4, W11), when the archive is configured.
  const archived = archive ? await requestArchive(trx, tenantId, sourceId) : undefined;
  return archived ? { jobId, archive: archived } : { jobId };
};

/**
 * Requests a snapshot of a source's URL (S4; ADR-0007 §4) in the actor's name: an archive job, if the source has a URL,
 * its copy stored (until then the URL can change) and no snapshot yet. If one is already waiting, that one is given
 * back, to be asked for again; none otherwise (the job rules would refuse it anyway). One open at a time (a unique
 * index).
 */
export const requestArchive = async (
  trx: Transaction<DB>,
  tenantId: string,
  sourceId: string,
): Promise<ArchiveJob | undefined> => {
  const source = await trx
    .selectFrom('app.source_documents')
    .select(['url', 'file_id', 'archive_url'])
    .where('id', '=', sourceId)
    .executeTakeFirst();
  if (!source?.url || source.file_id === null || source.archive_url !== null) {
    return undefined;
  }
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.job_requests (tenant_id, kind, source_document_id)
    VALUES (${tenantId}, 'archive_source', ${sourceId})
    ON CONFLICT (source_document_id) WHERE kind = 'archive_source' AND finished_at IS NULL DO NOTHING
    RETURNING id`.execute(trx);
  const jobId =
    rows[0]?.id ??
    (
      await trx
        .selectFrom('app.job_requests')
        .select('id')
        .where('source_document_id', '=', sourceId)
        .where('kind', '=', 'archive_source')
        .where('finished_at', 'is', null)
        .executeTakeFirst()
    )?.id;
  return jobId ? { jobId, url: source.url } : undefined;
};

/** The election's archive jobs still open (S4), or the one source's, with how long each has waited. */
export const openArchives = async (
  trx: Transaction<DB>,
  electionId: string,
  sourceId?: string,
): Promise<WaitingArchive[]> => {
  let query = trx
    .selectFrom('app.job_requests as j')
    .innerJoin('app.source_documents as s', 's.id', 'j.source_document_id')
    .select([
      'j.id as job_id',
      's.url',
      sql<number>`floor(extract(epoch FROM now() - j.created_at) * 1000)::bigint`.as('waited_ms'),
    ])
    .where('s.election_id', '=', electionId)
    .where('j.kind', '=', 'archive_source')
    .where('j.finished_at', 'is', null);
  if (sourceId !== undefined) {
    query = query.where('s.id', '=', sourceId);
  }
  const rows = await query.orderBy('j.created_at').execute();
  return rows.flatMap((row) =>
    row.url ? [{ jobId: row.job_id, url: row.url, waitedMs: Number(row.waited_ms) }] : [],
  );
};

/**
 * The election's extraction jobs still open (S3), or the one source's, with what the API needs to hand each to the
 * worker again and how long it has waited, by the database's clock: read in the member's own transaction, so RLS shows
 * only their sites' jobs (members read their tenant's job requests) and no other permission is needed (ADR-0006).
 */
export const openExtractions = async (
  trx: Transaction<DB>,
  electionId: string,
  sourceId?: string,
): Promise<WaitingExtraction[]> => {
  let query = trx
    .selectFrom('app.job_requests as j')
    .innerJoin('app.source_documents as s', 's.id', 'j.source_document_id')
    .innerJoin('app.files as f', 'f.id', 's.file_id')
    .select([
      'j.id as job_id',
      's.tenant_id',
      'f.sha256',
      'f.content_type',
      sql<number>`floor(extract(epoch FROM now() - j.created_at) * 1000)::bigint`.as('waited_ms'),
    ])
    .where('s.election_id', '=', electionId)
    .where('j.kind', '=', 'extract_source')
    .where('j.finished_at', 'is', null);
  if (sourceId !== undefined) {
    query = query.where('s.id', '=', sourceId);
  }
  const rows = await query.orderBy('j.created_at').execute();
  return rows.map((row) => ({
    jobId: row.job_id,
    tenantId: row.tenant_id,
    sha256: row.sha256,
    contentType: row.content_type,
    waitedMs: Number(row.waited_ms),
  }));
};

/** The source's extraction job still waiting (S3), with what the API needs to hand it to the worker again. */
export const pendingExtraction = async (
  trx: Transaction<DB>,
  electionId: string,
  sourceId: string,
): Promise<ExtractionJob | undefined> => {
  const [job] = await openExtractions(trx, electionId, sourceId);
  return job
    ? { jobId: job.jobId, tenantId: job.tenantId, sha256: job.sha256, contentType: job.contentType }
    : undefined;
};

/** An extraction job handed to the worker (R116): the API reads the bytes and sends them; the worker writes the text. */
export interface ExtractionJob {
  jobId: string;
  tenantId: string;
  sha256: string;
  contentType: string;
}

/** An extraction job still open, and for how long since it was requested. */
export interface WaitingExtraction extends ExtractionJob {
  waitedMs: number;
}

/** Hands extraction jobs to the worker, after their transaction committed (ADR-0006). */
export interface ExtractionDispatch {
  /** Hands a job over now (its upload, or a member asking again), trying again on its own while that may help. */
  dispatch: (job: ExtractionJob) => void;
  /** Open jobs a member's listing found: those waiting too long are handed over again, and reported past any limit. */
  waiting: (jobs: WaitingExtraction[]) => void;
}

/** An archive job (S4; ADR-0007 §4): the API asks the fetcher for a snapshot of `url`, then the worker records it. */
export interface ArchiveJob {
  jobId: string;
  url: string;
}

/** An archive job still open, and for how long since it was requested. */
export interface WaitingArchive extends ArchiveJob {
  waitedMs: number;
}

/** Asks for snapshots after their transaction committed, and again for those a listing finds waiting (ADR-0007). */
export interface ArchiveDispatch {
  dispatch: (job: ArchiveJob) => void;
  waiting: (jobs: WaitingArchive[]) => void;
}
