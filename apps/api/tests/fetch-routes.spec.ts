import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ArchiveJob, ExtractionJob, WaitingArchive } from '../src/admin/sources.js';
import type { FetchedCopy, FetcherClient, FetchProblem } from '../src/fetcher-client.js';

import { adminDataRoutes } from '../src/admin/routes.js';
import { ELECTIONS_A, TENANT_A, USERS } from './fixtures.js';
import './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const ORIGIN = 'https://admin.ejemplo.test';
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const owner = createDatabase({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});

/** What the fake fetcher answers next, and every URL it was asked for. */
let answer: () => FetchedCopy | { problem: FetchProblem };
/** What happens elsewhere while the fetcher fetches. */
let meanwhile: () => Promise<void> = async () => undefined;
const asked: string[] = [];
const fetcher: FetcherClient = {
  fetchCopy: async (url) => {
    asked.push(url);
    await meanwhile();
    return answer();
  },
  archive: async () => ({ archiveUrl: null }),
};
/** What was handed on after each transaction: extraction and archive jobs, and archive jobs found waiting. */
const extracting: ExtractionJob[] = [];
const archiving: ArchiveJob[] = [];
const waiting: WaitingArchive[][] = [];

let root: string;
let app: FastifyInstance;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'fetched-'));
  app = Fastify();
  await app.register(
    adminDataRoutes({
      admin,
      files: createFileStore(root),
      fetcher,
      extraction: { dispatch: (job) => extracting.push(job), waiting: () => undefined },
      archives: { dispatch: (job) => archiving.push(job), waiting: (jobs) => waiting.push(jobs) },
      adminOrigin: ORIGIN,
      actorFor: async (request) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
});

const made: string[] = [];

afterAll(async () => {
  for (const id of made) {
    await sql`DELETE FROM app.job_requests WHERE source_document_id = ${id}`.execute(owner);
    const { rows } = await sql<{ file_id: string | null }>`
      DELETE FROM app.source_documents WHERE id = ${id} RETURNING file_id`.execute(owner);
    if (rows[0]?.file_id) {
      await sql`DELETE FROM app.files WHERE id = ${rows[0].file_id}`.execute(owner);
    }
  }
  await app.close();
  await rm(root, { recursive: true, force: true });
  await Promise.all([admin.destroy(), owner.destroy()]);
});

beforeEach(() => {
  meanwhile = async () => undefined;
  asked.length = 0;
  extracting.length = 0;
  archiving.length = 0;
  waiting.length = 0;
});

const draft = ELECTIONS_A.draft;
const sources = `/api/t/test-a/e/${draft.slug}/sources`;
const PAGE = 'https://partido-ejemplo-a.example.org/programa.pdf';

const post = (url: string, as: string) =>
  app.inject({ method: 'POST', url, headers: { 'x-test-user': as, origin: ORIGIN } });

/** A source of A's draft election, as an editor adds it: with a URL unless told otherwise, and maybe its copy. */
const source = async (url: string | null = PAGE, { stored = false } = {}) => {
  const id = await owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true)`.execute(trx);
    const { rows } = await sql<{ id: string }>`
      INSERT INTO app.source_documents (tenant_id, election_id, kind, title, url)
      VALUES (${TENANT_A}, ${draft.id}, 'pdf', ${`Programa de prueba ${crypto.randomUUID()}`}, ${url})
      RETURNING id`.execute(trx);
    const sourceId = rows[0]?.id ?? '';
    if (stored) {
      const bytes = `%PDF-1.7 copia de prueba ${crypto.randomUUID()}`;
      const file = await sql<{ id: string }>`
        INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
        VALUES (${TENANT_A}, 'sources', 'application/pdf', ${bytes.length},
                encode(sha256(convert_to(${bytes}, 'UTF8')), 'hex'))
        RETURNING id`.execute(trx);
      await sql`UPDATE app.source_documents SET file_id = ${file.rows[0]?.id}, file_origin = 'uploaded'
                 WHERE id = ${sourceId}`.execute(trx);
    }
    return sourceId;
  });
  made.push(id);
  return id;
};

/** A copy as the fetcher gives it: unique bytes each time, so the store never reuses another test's. */
const copy = (contentType: string | undefined): FetchedCopy => ({
  contentType,
  finalUrl: 'https://partido-ejemplo-a.example.org/documentos/programa%20completo.pdf',
  body: Readable.from([Buffer.from(`%PDF-1.7 programa de prueba ${crypto.randomUUID()}`)]),
});

describe('a copy by URL (S2.1; ADR-0007 §3)', () => {
  it("is stored as the requester's upload, then its text and a snapshot are asked for", async () => {
    const id = await source();
    answer = () => copy('application/pdf');
    const stored = await post(`${sources}/${id}/fetch`, USERS.editorA);
    expect(stored.statusCode).toBe(201);
    expect(asked).toEqual([PAGE]);
    const { rows } = await sql<{
      origin: string;
      by: string;
      name: string;
      type: string;
      archive_job: string | null;
    }>`
      SELECT s.file_origin AS origin, f.created_by AS by, f.original_filename AS name, f.content_type AS type,
             (SELECT j.id FROM app.job_requests j WHERE j.source_document_id = s.id AND j.kind = 'archive_source'
                AND j.finished_at IS NULL AND j.requested_by = ${USERS.editorA}) AS archive_job
        FROM app.source_documents s JOIN app.files f ON f.id = s.file_id
       WHERE s.id = ${id}`.execute(owner);
    // An upload in the requester's name: four-eyes counts them as a contributor of every cell citing it (D17).
    expect(rows).toEqual([
      {
        origin: 'uploaded',
        by: USERS.editorA,
        name: 'programa completo.pdf',
        type: 'application/pdf',
        archive_job: expect.any(String),
      },
    ]);
    expect(extracting).toHaveLength(1);
    expect(archiving).toEqual([{ jobId: rows[0]?.archive_job, url: PAGE }]);
    // A stored copy never changes.
    expect((await post(`${sources}/${id}/fetch`, USERS.editorA)).json()).toEqual({
      error: 'hasCopy',
    });
  });

  it('is refused before anything is fetched: to a reviewer, for a source with no URL, for another site', async () => {
    const id = await source();
    const without = await source(null);
    expect((await post(`${sources}/${id}/fetch`, USERS.reviewerA)).statusCode).toBe(403);
    expect((await post(`${sources}/${without}/fetch`, USERS.editorA)).json()).toEqual({
      error: 'noUrl',
    });
    expect((await post(`${sources}/${id}/fetch`, USERS.countryAdminB)).statusCode).toBe(404);
    expect((await post(`${sources}/${crypto.randomUUID()}/fetch`, USERS.editorA)).statusCode).toBe(
      404,
    );
    expect(asked).toEqual([]);
  });

  it('is refused if the URL changed while it was fetched, and keeps a name without control characters', async () => {
    const id = await source();
    answer = () => copy('application/pdf');
    meanwhile = async () => {
      await sql`UPDATE app.source_documents SET url = 'https://partido-ejemplo-a.example.org/otro.pdf'
                 WHERE id = ${id}`.execute(owner);
    };
    expect((await post(`${sources}/${id}/fetch`, USERS.editorA)).json()).toEqual({
      error: 'stale',
    });
    expect(extracting).toEqual([]);

    meanwhile = async () => undefined;
    answer = () => ({
      ...copy('application/pdf'),
      finalUrl: 'https://partido-ejemplo-a.example.org/informe%00%E2%80%AEfdp.pdf',
    });
    expect((await post(`${sources}/${id}/fetch`, USERS.editorA)).statusCode).toBe(201);
    const { rows } = await sql<{ name: string }>`
      SELECT f.original_filename AS name FROM app.source_documents s JOIN app.files f ON f.id = s.file_id
       WHERE s.id = ${id}`.execute(owner);
    expect(rows).toEqual([{ name: 'informefdp.pdf' }]);
  });

  it('says why a URL gave no copy, and keeps nothing', async () => {
    const id = await source();
    for (const [given, status, error] of [
      [{ problem: 'refused' }, 422, 'fetchRefused'],
      [{ problem: 'failed' }, 422, 'fetchFailed'],
      [{ problem: 'tooLarge' }, 413, 'tooLarge'],
      [{ problem: 'fileType' }, 415, 'fileType'],
      [{ problem: 'unavailable' }, 503, 'fetchUnavailable'],
      [copy('application/zip'), 415, 'fileType'],
      [copy(undefined), 415, 'fileType'],
    ] as const) {
      answer = () => given;
      const refused = await post(`${sources}/${id}/fetch`, USERS.editorA);
      expect([refused.statusCode, refused.json()], error).toEqual([status, { error }]);
    }
    const { rows } =
      await sql`SELECT 1 FROM app.source_documents WHERE id = ${id} AND file_id IS NOT NULL`.execute(
        owner,
      );
    expect(rows).toEqual([]);
    expect(extracting).toEqual([]);
    expect(archiving).toEqual([]);
  });
});

describe('a snapshot asked for (S4; ADR-0007 §4)', () => {
  it('is an archive job in the requester’s name, the same one while it waits', async () => {
    const id = await source(PAGE, { stored: true });
    expect((await post(`${sources}/${id}/archive`, USERS.editorA)).statusCode).toBe(202);
    expect((await post(`${sources}/${id}/archive`, USERS.editorA)).statusCode).toBe(202);
    expect(archiving).toHaveLength(2);
    expect(archiving[0]).toEqual(archiving[1]);
    expect(archiving[0]?.url).toBe(PAGE);
    // Shown on the source, and found waiting by a listing.
    const listed = await app.inject({
      method: 'GET',
      url: `${sources}/${id}`,
      headers: { 'x-test-user': USERS.reviewerA },
    });
    expect(listed.json()).toMatchObject({
      source: { archiveRequested: true, archiveUrl: null },
      fetching: true,
      archiving: true,
    });
    expect(waiting.at(-1)).toEqual([
      { jobId: archiving[0]?.jobId, url: PAGE, waitedMs: expect.any(Number) },
    ]);
  });

  it('is refused to a reviewer, without a URL or a copy, and for a source with its snapshot', async () => {
    const id = await source(PAGE, { stored: true });
    const without = await source(null);
    // Until its copy is stored, its URL can change: the snapshot is taken with the copy.
    expect((await post(`${sources}/${await source()}/archive`, USERS.editorA)).json()).toEqual({
      error: 'noCopy',
    });
    expect((await post(`${sources}/${id}/archive`, USERS.reviewerA)).statusCode).toBe(403);
    expect((await post(`${sources}/${without}/archive`, USERS.editorA)).json()).toEqual({
      error: 'noUrl',
    });
    // The worker recorded one: as the database's owner here, for the test.
    await sql`UPDATE app.source_documents SET archive_url = 'https://archive.example.org/web/20261013120000/x'
               WHERE id = ${id}`.execute(owner);
    expect((await post(`${sources}/${id}/archive`, USERS.editorA)).json()).toEqual({
      error: 'hasArchive',
    });
    expect(archiving).toEqual([]);
  });
});
