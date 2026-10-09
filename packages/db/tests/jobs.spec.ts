import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import {
  ELECTIONS,
  JOB_PRINCIPALS,
  JOBS,
  LLM_RUNS,
  SOURCES,
  TENANT_A,
  TENANT_B,
  USERS,
} from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Runs `fn` as the worker running `jobId` for its requester (spec §8); jobId '' means no job. */
const asWorker = <T>(jobId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET LOCAL ROLE aiontheballot_worker');
    await client.query(
      `SELECT set_config('app.job_request_id', $1, true), set_config('app.user_id', $2, true)`,
      [jobId, JOB_PRINCIPALS['worker: fetch job of A'].requester],
    );
    return fn(client);
  });

const asEditorA = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.editorA],
    );
    return fn(client);
  });

const fetchedFile = (tenant = TENANT_A, bucket = 'sources'): string =>
  `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
   VALUES ('${tenant}', '${bucket}', 'text/html', 8, encode(sha256('obtenido'), 'hex')) RETURNING id`;

describe('a fetch job', () => {
  it("stores the source's copy as its requester, then finishes, after which it can do nothing", async () => {
    await asWorker(JOBS.fetchA.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(fetchedFile());
      const file = rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO app.file_blobs (file_id, tenant_id, content) VALUES ($1, $2, 'obtenido')`,
        [file, TENANT_A],
      );
      const attached = await client.query(
        `UPDATE app.source_documents SET file_id = $1, file_origin = 'fetched' WHERE id = $2
         RETURNING sha256 = encode(sha256('obtenido'), 'hex') AS hash`,
        [file, SOURCES.draftA.id],
      );
      expect(attached.rows).toEqual([{ hash: true }]);
      await client.query(`UPDATE app.job_requests SET finished_at = now() WHERE id = $1`, [
        JOBS.fetchA.id,
      ]);
      expect((await client.query('SELECT 1 FROM app.source_documents')).rowCount).toBe(0);
      expect(await errorCode(client, fetchedFile())).toBe(INSUFFICIENT_PRIVILEGE);
      await client.query('RESET ROLE');
      const stored = await client.query('SELECT created_by FROM app.files WHERE id = $1', [file]);
      expect(stored.rows).toEqual([{ created_by: USERS.platformAdmin }]);
    });
  });

  it.each([
    ['store a file in another tenant', fetchedFile(TENANT_B)],
    ['store a public asset', fetchedFile(TENANT_A, 'public_assets')],
    [
      'mark its source as extracted',
      `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = '${SOURCES.draftA.id}'`,
    ],
    [
      'archive its source',
      `UPDATE app.source_documents SET archive_url = 'https://archive.example.org/x' WHERE id = '${SOURCES.draftA.id}'`,
    ],
  ])('may not %s', async (_name, sql) => {
    expect(await asWorker(JOBS.fetchA.id, (c) => errorCode(c, sql))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("may not store a file in anyone else's name", async () => {
    const code = await asWorker(JOBS.fetchA.id, async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.editorA]);
      return errorCode(client, fetchedFile());
    });
    expect(code).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('records its copy as fetched, not uploaded', async () => {
    await asWorker(JOBS.fetchA.id, async (client) => {
      const { rows } = await client.query<{ id: string }>(fetchedFile());
      await client.query(
        `INSERT INTO app.file_blobs (file_id, tenant_id, content) VALUES ($1, $2, 'obtenido')`,
        [rows[0]?.id, TENANT_A],
      );
      expect(
        await errorCode(
          client,
          `UPDATE app.source_documents SET file_id = '${rows[0]?.id}', file_origin = 'uploaded' WHERE id = '${SOURCES.draftA.id}'`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('an extract job', () => {
  it("writes its source's pages, normalized, and marks it done", async () => {
    const [row] = await asWorker(JOBS.extractA.id, async (client) => {
      await client.query(
        `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES ($1, $2, 1, 'p. 1', 'Texto ﬁcticio extraído')`,
        [SOURCES.pendingA.id, TENANT_A],
      );
      await client.query(
        `UPDATE app.source_documents SET extraction_status = 'done' WHERE id = $1`,
        [SOURCES.pendingA.id],
      );
      return (
        await client.query(
          `SELECT normalized FROM app.source_texts WHERE source_document_id = $1`,
          [SOURCES.pendingA.id],
        )
      ).rows;
    });
    expect(row).toEqual({ normalized: 'Texto ficticio extraído' });
  });

  it('may not write the pages of another source, or attach a copy', async () => {
    await asWorker(JOBS.extractA.id, async (client) => {
      expect(
        await errorCode(
          client,
          `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
           VALUES ('${SOURCES.liveA.id}', '${TENANT_A}', 9, 'p. 9', 'Texto añadido')`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('an LLM job', () => {
  it('runs, writes suggestions for its own run, and records its cost', async () => {
    await asWorker(JOBS.llmA.id, async (client) => {
      await client.query(`UPDATE app.llm_runs SET status = 'running' WHERE id = $1`, [
        LLM_RUNS.A.id,
      ]);
      await client.query(
        `INSERT INTO app.llm_suggestions (tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating,
                                          rationale, passages)
         VALUES ($1, $2, $3, $4, $5, 'meets', 'Razonamiento', '[]')`,
        [
          TENANT_A,
          ELECTIONS.liveA.id,
          LLM_RUNS.A.id,
          ELECTIONS.liveA.secondParty,
          ELECTIONS.liveA.criterion,
        ],
      );
      const done = await client.query(
        `UPDATE app.llm_runs SET status = 'done', cost_usd = 0.25, input_tokens = 100, output_tokens = 50
          WHERE id = $1 RETURNING finished_at = now() AS now`,
        [LLM_RUNS.A.id],
      );
      expect(done.rows).toEqual([{ now: true }]);
    });
  });

  it("may not write suggestions for another tenant's run, or see anything outside its job", async () => {
    await asWorker(JOBS.llmA.id, async (client) => {
      expect(
        await errorCode(
          client,
          `INSERT INTO app.llm_suggestions (tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating,
                                            rationale, passages)
           VALUES ('${TENANT_B}', '${ELECTIONS.liveB.id}', '${LLM_RUNS.B.id}', '${ELECTIONS.liveB.party}',
                   '${ELECTIONS.liveB.criterion}', 'meets', 'Razonamiento', '[]')`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        (
          await client.query(`SELECT 1 FROM app.source_documents WHERE id = $1`, [
            SOURCES.draftA.id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await client.query(`SELECT 1 FROM app.parties WHERE election_id = $1`, [
            ELECTIONS.draftA.id,
          ])
        ).rowCount,
      ).toBe(0);
    });
  });
});

describe('a worker without an open job', () => {
  it.each([
    ['no job set', ''],
    ['a finished job', JOBS.finishedA.id],
  ])('sees nothing with %s', async (_name, job) => {
    const seen = await asWorker(job, async (client) =>
      Promise.all(
        ['job_requests', 'tenants', 'source_documents', 'files', 'llm_runs'].map(
          async (table) => (await client.query(`SELECT 1 FROM app.${table}`)).rowCount,
        ),
      ),
    );
    expect(seen).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('job requests', () => {
  const request = (kind: string, source: string, run = 'NULL'): string =>
    `INSERT INTO app.job_requests (tenant_id, kind, source_document_id, llm_run_id)
     VALUES ('${TENANT_A}', '${kind}', '${source}', ${run}) RETURNING requested_by`;

  it('are requested by the actor', async () => {
    const [row] = await asEditorA(
      async (c) => (await c.query(request('archive_source', SOURCES.liveA.id))).rows,
    );
    expect(row).toEqual({ requested_by: USERS.editorA });
  });

  it.each([
    ['a fetch for a source that already has a copy', request('fetch_source', SOURCES.liveA.id)],
    ['an extraction for a source already extracted', request('extract_source', SOURCES.liveA.id)],
    ['an extraction for a source without a copy', request('extract_source', SOURCES.draftA.id)],
    [
      'an LLM run that is not queued',
      `UPDATE app.llm_runs SET status = 'running' WHERE id = '${LLM_RUNS.A.id}'; ${request('llm_run', SOURCES.liveA.id, `'${LLM_RUNS.A.id}'`)}`,
    ],
  ])('refuse %s', async (_name, sql) => {
    const code = await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.editorA]);
      return errorCode(client, sql);
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('refuse an LLM run of another source', async () => {
    expect(
      await asEditorA((c) =>
        errorCode(c, request('llm_run', SOURCES.draftA.id, `'${LLM_RUNS.A.id}'`)),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('change only by finishing, once, at the transaction time', async () => {
    await inRolledBackTransaction(async (client) => {
      const job = `id = '${JOBS.fetchA.id}'`;
      expect(
        await errorCode(client, `UPDATE app.job_requests SET kind = 'archive_source' WHERE ${job}`),
      ).toBe(RESTRICT_VIOLATION);
      const { rows } = await client.query(
        `UPDATE app.job_requests SET finished_at = '2000-01-01' WHERE ${job} RETURNING finished_at = now() AS now`,
      );
      expect(rows).toEqual([{ now: true }]);
      expect(
        await errorCode(client, `UPDATE app.job_requests SET finished_at = now() WHERE ${job}`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});
