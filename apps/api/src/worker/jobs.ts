import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { createHash } from 'node:crypto';

import type { Extraction } from './extract.js';

/**
 * An extraction job, as the worker runs it (editorial workflow S3; PLAN R116): as `aiontheballot_worker`, which sees
 * only the open job whose id it names (`app.job_request_id`) and writes in its requester's name (`app.user_id`). The
 * API hands it the bytes of the job's copy; they are used only if their SHA-256 is the one the source recorded, so
 * whoever reaches the worker can't make it store text that isn't the source's. Its text is untrusted: it is only ever
 * stored, matched and shown as text.
 */

export type JobOutcome = 'done' | 'not-found' | 'mismatch';

/** Runs `fn` as the worker on job `jobId`, an open job of `kind`, in its requester's name once known. */
const asWorkerOn = async <T>(
  db: Database,
  jobId: string,
  fn: (trx: Transaction<DB>, job: { sourceId: string }) => Promise<T>,
  kind: 'extract_source' | 'archive_source' = 'extract_source',
): Promise<T | undefined> =>
  db.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.job_request_id', ${jobId}, true)`.execute(trx);
    const job = await trx
      .selectFrom('app.job_requests')
      .select(['source_document_id', 'requested_by', 'kind'])
      .where('id', '=', jobId)
      .where('finished_at', 'is', null)
      .executeTakeFirst();
    if (!job || job.kind !== kind) {
      return undefined;
    }
    await sql`SELECT set_config('app.user_id', ${job.requested_by}, true)`.execute(trx);
    return fn(trx, { sourceId: job.source_document_id });
  });

/** The job's source, if it is still waiting for its text: its copy's hash and type. */
export const jobSource = (
  db: Database,
  jobId: string,
): Promise<{ sha256: string; contentType: string } | undefined> =>
  asWorkerOn(db, jobId, async (trx, { sourceId }) => {
    const source = await trx
      .selectFrom('app.source_documents as s')
      .innerJoin('app.files as f', 'f.id', 's.file_id')
      .select(['s.sha256', 'f.content_type', 's.extraction_status'])
      .where('s.id', '=', sourceId)
      .executeTakeFirst();
    return source?.sha256 && source.extraction_status === 'pending'
      ? { sha256: source.sha256, contentType: source.content_type }
      : undefined;
  }).then((found) => found ?? undefined);

/** Whether the bytes are the copy the source recorded. */
export const isCopy = (bytes: Uint8Array, sha256: string): boolean =>
  createHash('sha256').update(bytes).digest('hex') === sha256;

/**
 * Writes what extraction gave, or that it failed, and finishes the job: its units, then the source's status (once,
 * from pending), then the job, in one transaction.
 */
export const finishExtraction = async (
  db: Database,
  jobId: string,
  result: Extraction | { status: 'failed' },
): Promise<boolean> =>
  (await asWorkerOn(db, jobId, async (trx, { sourceId }) => {
    const source = await trx
      .selectFrom('app.source_documents')
      .select('tenant_id')
      .where('id', '=', sourceId)
      .executeTakeFirstOrThrow();
    if (result.status === 'done') {
      // Plain SQL: the generated column and the worker's column grants are the database's to apply.
      for (const unit of result.units) {
        await sql`
          INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
          VALUES (${sourceId}, ${source.tenant_id}, ${unit.index}, ${unit.label}, ${unit.body})`.execute(
          trx,
        );
      }
    }
    await trx
      .updateTable('app.source_documents')
      .set({ extraction_status: result.status })
      .where('id', '=', sourceId)
      .execute();
    await trx
      .updateTable('app.job_requests')
      .set({ finished_at: sql`now()` })
      .where('id', '=', jobId)
      .execute();
    return true;
  })) === true;

/**
 * Records an archive job's snapshot, if the archive gave one, and finishes the job (S4; ADR-0007 §4): the API asked
 * the fetcher, which asked the archive; the worker holds the only grant on a source's archive URL, and only while its
 * archive job is open, and sets it in the job's requester's name. With none, the job is finished without it, and the
 * source offers to ask again. False when the job isn't an open archive job.
 */
export const finishArchive = async (
  db: Database,
  jobId: string,
  archiveUrl: string | null,
): Promise<boolean> =>
  (await asWorkerOn(
    db,
    jobId,
    async (trx, { sourceId }) => {
      if (archiveUrl !== null) {
        await trx
          .updateTable('app.source_documents')
          .set({ archive_url: archiveUrl })
          .where('id', '=', sourceId)
          .execute();
      }
      await trx
        .updateTable('app.job_requests')
        .set({ finished_at: sql`now()` })
        .where('id', '=', jobId)
        .execute();
      return true;
    },
    'archive_source',
  )) === true;
