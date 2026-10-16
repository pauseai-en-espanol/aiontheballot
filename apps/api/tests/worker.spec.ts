import type { AddressInfo } from 'node:net';

import { createDatabase } from '@aiontheballot/db/client';
import { sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';

import { extract } from '../src/worker/extract.js';
import { buildWorkerApp, type Extractor, MAX_COPY_BYTES } from '../src/worker/server.js';
import { ELECTIONS_A, TENANT_A, USERS } from './fixtures.js';
import './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

/** The worker's login, as production has it: the test database as aiontheballot_worker. */
const workerUrl = new URL(env('TEST_SUPERUSER_DATABASE_URL'));
workerUrl.searchParams.set('options', '-c role=aiontheballot_worker');
const worker = createDatabase({ connectionString: workerUrl.toString(), maxConnections: 2 });
const owner = createDatabase({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});
const made: string[] = [];

afterAll(async () => {
  for (const id of made) {
    await sql`DELETE FROM app.job_requests WHERE source_document_id = ${id}`.execute(owner);
    await owner.transaction().execute(async (trx) => {
      await sql`ALTER TABLE app.source_texts DISABLE TRIGGER USER`.execute(trx);
      await sql`DELETE FROM app.source_texts WHERE source_document_id = ${id}`.execute(trx);
      await sql`ALTER TABLE app.source_texts ENABLE TRIGGER USER`.execute(trx);
    });
    const { rows } = await sql<{ file_id: string }>`
      DELETE FROM app.source_documents WHERE id = ${id} RETURNING file_id`.execute(owner);
    if (rows[0]?.file_id) {
      await sql`DELETE FROM app.files WHERE id = ${rows[0].file_id}`.execute(owner);
    }
  }
  await Promise.all([worker.destroy(), owner.destroy()]);
});

/** A source with a stored copy of `bytes` and an open extraction job, as an editor's upload leaves them. */
const uploaded = async (bytes: Uint8Array, contentType: string) =>
  owner.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true)`.execute(trx);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const file = await sql<{ id: string }>`
      INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
      VALUES (${TENANT_A}, 'sources', ${contentType}, ${bytes.byteLength}, ${sha256}) RETURNING id`.execute(
      trx,
    );
    const source = await sql<{ id: string }>`
      INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
      VALUES (${TENANT_A}, ${ELECTIONS_A.draft.id}, 'web_page', ${`Fuente de prueba ${randomUUID()}`})
      RETURNING id`.execute(trx);
    const sourceId = source.rows[0]?.id ?? '';
    made.push(sourceId);
    await sql`UPDATE app.source_documents SET file_id = ${file.rows[0]?.id}, file_origin = 'uploaded'
               WHERE id = ${sourceId}`.execute(trx);
    const job = await sql<{ id: string }>`
      INSERT INTO app.job_requests (tenant_id, kind, source_document_id)
      VALUES (${TENANT_A}, 'extract_source', ${sourceId}) RETURNING id`.execute(trx);
    return { sourceId, jobId: job.rows[0]?.id ?? '' };
  });

/** The extraction in this process, a parser's error counted as the document's, as the child extractor counts it. */
const inProcess: Extractor = async (contentType, bytes) => {
  try {
    return await extract(contentType, bytes);
  } catch {
    return { status: 'failed' };
  }
};

/** The secret the worker shares with the API (ADR-0006): fictional, for these tests only. */
const TOKEN = 'un-secreto-compartido-de-prueba-de-mas-de-32';
const AUTHORIZED = { authorization: `Bearer ${TOKEN}` };

const post = (
  app: ReturnType<typeof buildWorkerApp>,
  jobId: string,
  bytes: Uint8Array,
  headers: Record<string, string> = AUTHORIZED,
) =>
  app.inject({
    method: 'POST',
    url: `/jobs/${jobId}`,
    headers: { 'content-type': 'application/octet-stream', ...headers },
    payload: Buffer.from(bytes),
  });

const run = async (extractor: Extractor, jobId: string, bytes: Uint8Array) => {
  const app = buildWorkerApp({ db: worker, extractor, token: TOKEN });
  try {
    return await post(app, jobId, bytes);
  } finally {
    await app.close();
  }
};

const stateOf = async (sourceId: string, jobId: string) => {
  const { rows } = await sql<{ status: string; finished: boolean; units: string[] }>`
    SELECT s.extraction_status AS status, j.finished_at IS NOT NULL AS finished,
           ARRAY(SELECT t.label FROM app.source_texts t WHERE t.source_document_id = s.id ORDER BY t.unit_index) AS units
      FROM app.source_documents s JOIN app.job_requests j ON j.source_document_id = s.id
     WHERE s.id = ${sourceId} AND j.id = ${jobId}`.execute(owner);
  return rows[0];
};

describe('the worker (editorial workflow S3; PLAN R116)', () => {
  it("writes the copy's text in its requester's name, and finishes the job", async () => {
    const bytes = new TextEncoder().encode('Primer bloque inventado.\n\nSegundo bloque inventado.');
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    const answer = await run(inProcess, jobId, bytes);
    expect(answer.statusCode).toBe(204);
    expect(await stateOf(sourceId, jobId)).toEqual({
      status: 'done',
      finished: true,
      units: ['§ 1', '§ 2'],
    });
    // In the name of whoever stored the copy (W11): the audit log says who set the status.
    const { rows: actors } = await sql<{ actor: string | null }>`
      SELECT actor_id AS actor FROM app.audit_log
       WHERE table_name = 'source_documents' AND row_id = ${sourceId} AND action = 'update'
         AND diff -> 'new' ? 'extraction_status'`.execute(owner);
    expect(actors).toEqual([{ actor: USERS.editorA }]);
    // A finished job is nobody's to run again.
    expect((await run(inProcess, jobId, bytes)).statusCode).toBe(404);
  });

  it("refuses bytes that aren't the source's copy, and writes nothing", async () => {
    const bytes = new TextEncoder().encode('El texto que se guardó.');
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    const answer = await run(inProcess, jobId, new TextEncoder().encode('Otro texto, inyectado.'));
    expect(answer.statusCode).toBe(422);
    expect(await stateOf(sourceId, jobId)).toEqual({
      status: 'pending',
      finished: false,
      units: [],
    });
  });

  it('records a parser that fails, and a copy with no text', async () => {
    const broken = new TextEncoder().encode('no es un PDF');
    const first = await uploaded(broken, 'application/pdf');
    expect((await run(inProcess, first.jobId, broken)).statusCode).toBe(204);
    expect(await stateOf(first.sourceId, first.jobId)).toMatchObject({
      status: 'failed',
      finished: true,
    });

    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const second = await uploaded(image, 'image/png');
    expect((await run(inProcess, second.jobId, image)).statusCode).toBe(204);
    expect(await stateOf(second.sourceId, second.jobId)).toMatchObject({
      status: 'not_applicable',
      finished: true,
    });
  });

  it('leaves the job open when the worker itself fails, for it to be asked again', async () => {
    const bytes = new TextEncoder().encode('Un texto inventado que el analizador no llega a leer.');
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    const broken: Extractor = () => Promise.reject(new Error('spawn ENOMEM'));
    expect((await run(broken, jobId, bytes)).statusCode).toBe(503);
    expect(await stateOf(sourceId, jobId)).toEqual({
      status: 'pending',
      finished: false,
      units: [],
    });
    expect((await run(inProcess, jobId, bytes)).statusCode).toBe(204);
  });

  it('runs one job at a time, refuses a job already here, and the rest past the queue', async () => {
    const first = new TextEncoder().encode('Primer texto inventado para la cola.');
    const second = new TextEncoder().encode('Segundo texto inventado para la cola.');
    const a = await uploaded(first, 'text/plain');
    const b = await uploaded(second, 'text/plain');
    let running = 0;
    let most = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Extractor = async (contentType, bytes) => {
      running += 1;
      most = Math.max(most, running);
      await held;
      running -= 1;
      return inProcess(contentType, bytes);
    };
    const app = buildWorkerApp({ db: worker, extractor: slow, token: TOKEN, maxWaiting: 1 });
    try {
      const one = post(app, a.jobId, first);
      // The same job again while it is here: refused, not parsed twice.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((await post(app, a.jobId, first)).statusCode).toBe(409);
      const two = post(app, b.jobId, second);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // One runs and one waits: a third finds the queue full.
      expect((await post(app, randomUUID(), second)).statusCode).toBe(503);
      release();
      expect((await one).statusCode).toBe(204);
      expect((await two).statusCode).toBe(204);
      expect(most).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('lets a job whose request went away be asked for again at once, and skips it when its turn comes', async () => {
    const first = new TextEncoder().encode('Texto inventado que ocupa al trabajador.');
    const second = new TextEncoder().encode('Texto inventado cuyo pedido se abandona.');
    const a = await uploaded(first, 'text/plain');
    const b = await uploaded(second, 'text/plain');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let parsed = 0;
    const slow: Extractor = async (contentType, bytes) => {
      parsed += 1;
      await held;
      return inProcess(contentType, bytes);
    };
    const app = buildWorkerApp({ db: worker, extractor: slow, token: TOKEN });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    // Over a real connection, so it can go away: the API giving up, or restarting.
    const send = (jobId: string, bytes: Uint8Array) => {
      const outgoing = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: `/jobs/${jobId}`,
        headers: {
          ...AUTHORIZED,
          'content-type': 'application/octet-stream',
          'content-length': bytes.byteLength,
        },
      });
      const answered = new Promise<number>((resolve, reject) => {
        outgoing.once('response', (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        outgoing.once('error', reject);
      });
      outgoing.end(Buffer.from(bytes));
      return { outgoing, answered };
    };
    try {
      const one = send(a.jobId, first);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const abandoned = send(b.jobId, second);
      abandoned.answered.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 100));
      abandoned.outgoing.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Asked again: taken, not refused as already here.
      const again = send(b.jobId, second);
      release();
      expect(await one.answered).toBe(204);
      expect(await again.answered).toBe(204);
      // The abandoned request was skipped: two parses, not three.
      expect(parsed).toBe(2);
      expect(await stateOf(b.sourceId, b.jobId)).toMatchObject({ status: 'done', finished: true });
    } finally {
      await app.close();
    }
  });

  it('refuses a body larger than a copy can be, and writes nothing', async () => {
    const bytes = new TextEncoder().encode('Un texto inventado.');
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    const answer = await run(inProcess, jobId, new Uint8Array(MAX_COPY_BYTES + 1));
    expect(answer.statusCode).toBe(413);
    expect(await stateOf(sourceId, jobId)).toEqual({
      status: 'pending',
      finished: false,
      units: [],
    });
  });

  it('knows no job by a made-up id', async () => {
    expect((await run(inProcess, randomUUID(), new Uint8Array([1]))).statusCode).toBe(404);
  });

  it('refuses a job without the secret it shares with the API, before looking at anything (ADR-0006)', async () => {
    const bytes = new TextEncoder().encode(
      'Un texto inventado que nadie sin el secreto hace leer.',
    );
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    let parsed = 0;
    const counting: Extractor = async (contentType, copy) => {
      parsed += 1;
      return inProcess(contentType, copy);
    };
    const app = buildWorkerApp({ db: worker, extractor: counting, token: TOKEN });
    try {
      for (const headers of [
        {} as Record<string, string>,
        { authorization: TOKEN },
        { authorization: `Bearer ${TOKEN.slice(0, -1)}` },
        { authorization: `Bearer ${TOKEN}x` },
        { authorization: `Basic ${TOKEN}` },
      ]) {
        const answer = await post(app, jobId, bytes, headers);
        expect(answer.statusCode).toBe(401);
        expect(answer.json()).toEqual({ error: 'unauthorized' });
      }
      // Not even whether the job exists, or whether the id is well formed.
      expect((await post(app, randomUUID(), bytes, {})).statusCode).toBe(401);
      expect((await post(app, 'not-a-job', bytes, {})).statusCode).toBe(401);
      expect(parsed).toBe(0);
      expect(await stateOf(sourceId, jobId)).toEqual({
        status: 'pending',
        finished: false,
        units: [],
      });
      // The probe stays open to the kubelet, and says nothing about jobs.
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      expect((await post(app, jobId, bytes)).statusCode).toBe(204);
      expect(parsed).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('says nothing of a job it has to whoever lacks the secret, over a real connection too (ADR-0006)', async () => {
    const bytes = new TextEncoder().encode(
      'Un texto inventado que el trabajador retiene un momento.',
    );
    const { jobId } = await uploaded(bytes, 'text/plain');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Extractor = async (contentType, copy) => {
      await held;
      return inProcess(contentType, copy);
    };
    const app = buildWorkerApp({ db: worker, extractor: slow, token: TOKEN });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const send = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const outgoing = httpRequest({
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/jobs/${jobId}`,
          headers: {
            ...headers,
            'content-type': 'application/octet-stream',
            'content-length': bytes.byteLength,
          },
        });
        outgoing.once('response', (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        outgoing.once('error', reject);
        outgoing.end(Buffer.from(bytes));
      });
    try {
      const running = send(AUTHORIZED);
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The job is here: with the secret that's a 409; without it, the same 401 as for any job.
      expect(await send(AUTHORIZED)).toBe(409);
      expect(await send({})).toBe(401);
      expect(await send({ authorization: `Bearer ${TOKEN.slice(1)}` })).toBe(401);
      release();
      expect(await running).toBe(204);
    } finally {
      release();
      await app.close();
    }
  });

  it('reports its own faults by their class only, never their message, and leaves the job open', async () => {
    const bytes = new TextEncoder().encode('Un texto inventado para un fallo del trabajador.');
    const { sourceId, jobId } = await uploaded(bytes, 'text/plain');
    const faults: string[] = [];
    // The parser can't start: 503, for the API to try again.
    const broken: Extractor = () =>
      Promise.reject(
        Object.assign(new Error('spawn failed: secreto del documento'), { name: 'SpawnError' }),
      );
    const failing = buildWorkerApp({
      db: worker,
      extractor: broken,
      token: TOKEN,
      onFault: (error) => faults.push(error.message),
    });
    try {
      expect((await post(failing, jobId, bytes)).statusCode).toBe(503);
    } finally {
      await failing.close();
    }
    // Writing the text fails (a database error, whose message could quote it): 500, reported by its SQLSTATE.
    const unwritable: Extractor = async () => ({
      status: 'done',
      units: [
        { index: 0, label: '§ 1', body: 'Un texto inventado.' },
        { index: 0, label: '§ 1', body: 'Otra vez.' },
      ],
    });
    const faulty = buildWorkerApp({
      db: worker,
      extractor: unwritable,
      token: TOKEN,
      onFault: (error) => faults.push(error.message),
    });
    try {
      const answer = await post(faulty, jobId, bytes);
      expect(answer.statusCode).toBe(500);
      expect(answer.json()).toEqual({ error: 'internal' });
    } finally {
      await faulty.close();
    }
    expect(faults).toEqual([
      'Extraction could not run: SpawnError',
      expect.stringMatching(/^Extraction job failed: SQLSTATE [0-9A-Z]{5} in \w+$/),
    ]);
    expect(faults.join(' ')).not.toMatch(/secreto|texto/);
    expect(await stateOf(sourceId, jobId)).toEqual({
      status: 'pending',
      finished: false,
      units: [],
    });
  });
});

describe("the worker's archive door (S4; ADR-0007 §4)", () => {
  /** A source with a URL, its copy stored, and an open archive job, as an editor's upload leaves them. */
  const awaitingSnapshot = async () =>
    owner.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true)`.execute(trx);
      const source = await sql<{ id: string }>`
        INSERT INTO app.source_documents (tenant_id, election_id, kind, title, url)
        VALUES (${TENANT_A}, ${ELECTIONS_A.draft.id}, 'web_page', ${`Fuente de prueba ${randomUUID()}`},
                'https://partido-ejemplo-a.example.org/programa')
        RETURNING id`.execute(trx);
      const sourceId = source.rows[0]?.id ?? '';
      made.push(sourceId);
      const bytes = `Una página de prueba ${randomUUID()}`;
      const file = await sql<{ id: string }>`
        INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
        VALUES (${TENANT_A}, 'sources', 'text/html', ${bytes.length},
                encode(sha256(convert_to(${bytes}, 'UTF8')), 'hex'))
        RETURNING id`.execute(trx);
      await sql`UPDATE app.source_documents SET file_id = ${file.rows[0]?.id}, file_origin = 'uploaded'
                 WHERE id = ${sourceId}`.execute(trx);
      const job = await sql<{ id: string }>`
        INSERT INTO app.job_requests (tenant_id, kind, source_document_id)
        VALUES (${TENANT_A}, 'archive_source', ${sourceId}) RETURNING id`.execute(trx);
      return { sourceId, jobId: job.rows[0]?.id ?? '' };
    });
  const SNAPSHOT =
    'https://archive.example.org/web/20261013120000/https://partido-ejemplo-a.example.org/programa';

  const archived = async (
    jobId: string,
    body: unknown,
    headers: Record<string, string> = AUTHORIZED,
  ) => {
    const app = buildWorkerApp({ db: worker, extractor: inProcess, token: TOKEN });
    try {
      return await app.inject({
        method: 'POST',
        url: `/archives/${jobId}`,
        headers: { 'content-type': 'application/json', ...headers },
        payload: JSON.stringify(body),
      });
    } finally {
      await app.close();
    }
  };

  const snapshotOf = async (sourceId: string, jobId: string) =>
    (
      await sql<{ archive: string | null; finished: boolean }>`
        SELECT s.archive_url AS archive, j.finished_at IS NOT NULL AS finished
          FROM app.source_documents s JOIN app.job_requests j ON j.source_document_id = s.id
         WHERE s.id = ${sourceId} AND j.id = ${jobId}`.execute(owner)
    ).rows[0];

  it("records the snapshot in its requester's name, and finishes the job", async () => {
    const { sourceId, jobId } = await awaitingSnapshot();
    expect((await archived(jobId, { archiveUrl: SNAPSHOT })).statusCode).toBe(204);
    expect(await snapshotOf(sourceId, jobId)).toEqual({ archive: SNAPSHOT, finished: true });
    const { rows: actors } = await sql<{ actor: string | null }>`
      SELECT actor_id AS actor FROM app.audit_log
       WHERE table_name = 'source_documents' AND row_id = ${sourceId} AND action = 'update'
         AND diff -> 'new' ? 'archive_url'`.execute(owner);
    expect(actors).toEqual([{ actor: USERS.editorA }]);
    expect((await archived(jobId, { archiveUrl: SNAPSHOT })).statusCode).toBe(404);
  });

  it('finishes the job without a snapshot when the archive gave none, so another can be asked for', async () => {
    const { sourceId, jobId } = await awaitingSnapshot();
    expect((await archived(jobId, { archiveUrl: null })).statusCode).toBe(204);
    expect(await snapshotOf(sourceId, jobId)).toEqual({ archive: null, finished: true });
  });

  it("refuses without the secret, an address that isn't https, and any job but an open archive", async () => {
    const { sourceId, jobId } = await awaitingSnapshot();
    for (const headers of [{}, { authorization: 'Bearer otro-secreto' }] as Record<
      string,
      string
    >[]) {
      expect((await archived(jobId, { archiveUrl: SNAPSHOT }, headers)).statusCode).toBe(401);
    }
    for (const archiveUrl of [
      'http://archive.example.org/web/20261013120000/x',
      'javascript:alert(1)',
      'https://usuario:clave@archive.example.org/x',
    ]) {
      expect((await archived(jobId, { archiveUrl })).statusCode, archiveUrl).toBe(400);
    }
    expect((await archived(jobId, {})).statusCode).toBe(400);
    const bytes = new TextEncoder().encode('Un texto inventado para un trabajo de extracción.');
    const extraction = await uploaded(bytes, 'text/plain');
    expect((await archived(extraction.jobId, { archiveUrl: SNAPSHOT })).statusCode).toBe(404);
    expect(await snapshotOf(sourceId, jobId)).toEqual({ archive: null, finished: false });
  });
});
