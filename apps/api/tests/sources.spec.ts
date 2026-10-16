import type { AddressInfo } from 'node:net';

import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore, type FileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ExtractionJob, WaitingExtraction } from '../src/admin/sources.js';

import { adminDataRoutes } from '../src/admin/routes.js';
import { ELECTIONS_A, LIVE_A, TENANT_A, USERS } from './fixtures.js';
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
const dispatched: ExtractionJob[] = [];
/** What each listing handed the dispatch as still open (ADR-0006). */
const listed: WaitingExtraction[][] = [];
let root: string;
let files: FileStore;
let app: FastifyInstance;
/** How many uploads reached the store: a refused one never does, its body unread. */
let streamed = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sources-'));
  const store = createFileStore(root);
  files = {
    ...store,
    putStream: (...args) => {
      streamed += 1;
      return store.putStream(...args);
    },
  };
  app = Fastify();
  await app.register(
    adminDataRoutes({
      admin,
      files,
      extraction: {
        dispatch: (job) => dispatched.push(job),
        waiting: (jobs) => listed.push(jobs),
      },
      adminOrigin: ORIGIN,
      actorFor: async (request) => {
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
  await Promise.all([admin.destroy(), owner.destroy()]);
});

const send = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  as: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    headers: {
      'x-test-user': as,
      ...(method === 'GET' ? {} : { origin: ORIGIN }),
      ...(body === undefined || Buffer.isBuffer(body)
        ? {}
        : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });

// A's draft election: structure may change there, and its sources are the tests' own.
const base = `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/sources`;
const [PARTY] = ELECTIONS_A.draft.parties;
const FIELDS = {
  title: '  Programa de prueba  ',
  kind: 'pdf',
  url: 'https://example.org/programa-de-prueba.pdf',
  language: 'es',
  partyId: PARTY,
  isProgramme: true,
};

/** Removes what a test made, as the owner: the sources, their jobs and their file rows. */
const cleanUp = async (ids: string[]) => {
  for (const id of ids) {
    await sql`DELETE FROM app.job_requests WHERE source_document_id = ${id}`.execute(owner);
    const { rows } = await sql<{ file_id: string | null }>`
      SELECT file_id FROM app.source_documents WHERE id = ${id}`.execute(owner);
    await sql`DELETE FROM app.source_documents WHERE id = ${id}`.execute(owner);
    if (rows[0]?.file_id) {
      await sql`DELETE FROM app.files WHERE id = ${rows[0].file_id}
                  AND NOT EXISTS (SELECT 1 FROM app.source_documents s WHERE s.file_id = files.id)`.execute(
        owner,
      );
    }
  }
};

describe('sources (editorial workflow S1, S2, S5, S6)', () => {
  it('are added and changed by editors until they have a copy, and listed to every member', async () => {
    const made: string[] = [];
    try {
      const created = await send('POST', base, USERS.editorA, FIELDS);
      expect(created.statusCode).toBe(201);
      const { id } = created.json<{ id: string }>();
      made.push(id);
      const listed = await send('GET', base, USERS.reviewerA);
      expect(listed.json()).toMatchObject({ canEdit: false, uploads: true });
      expect(listed.json<{ sources: { id: string }[] }>().sources).toContainEqual(
        expect.objectContaining({
          id,
          title: 'Programa de prueba',
          isProgramme: true,
          copy: null,
          extractionStatus: 'pending',
          citations: 0,
        }),
      );
      const changed = await send('PUT', `${base}/${id}`, USERS.editorA, {
        ...FIELDS,
        title: 'Otro título',
      });
      expect(changed.statusCode).toBe(204);
      expect((await send('POST', base, USERS.reviewerA, FIELDS)).statusCode).toBe(403);
      expect((await send('POST', base, USERS.editorA, { ...FIELDS, title: '  ' })).statusCode).toBe(
        422,
      );
      expect(
        (await send('POST', base, USERS.editorA, { ...FIELDS, partyId: null })).json(),
      ).toMatchObject({ error: 'incomplete' });
      // Any language a party writes in, not only the app's own; a code, never a name.
      const catalan = await send('POST', base, USERS.editorA, { ...FIELDS, language: 'ca' });
      expect(catalan.statusCode).toBe(201);
      made.push(catalan.json<{ id: string }>().id);
      expect(
        (await send('POST', base, USERS.editorA, { ...FIELDS, language: 'Català' })).statusCode,
      ).toBe(400);
      // One source, as every member reads it, with its text (none yet).
      const one = await send('GET', `${base}/${id}`, USERS.reviewerA);
      expect(one.json()).toMatchObject({
        source: { id, title: 'Otro título', citable: false },
        units: [],
        canEdit: false,
      });
      expect((await send('GET', `${base}/${id}`, USERS.countryAdminB)).statusCode).toBe(404);
    } finally {
      await cleanUp(made);
    }
  });

  it('are marked replaced once, by those who write them, and listed last (PLAN D14)', async () => {
    const made: string[] = [];
    try {
      const { id: old } = (
        await send('POST', base, USERS.editorA, { ...FIELDS, title: 'A: versión antigua' })
      ).json<{ id: string }>();
      made.push(old);
      const { id: newer } = (
        await send('POST', base, USERS.editorA, { ...FIELDS, title: 'Z: versión nueva' })
      ).json<{ id: string }>();
      made.push(newer);
      const mark = (id: string, as: string) => send('POST', `${base}/${id}/replaced`, as);
      expect((await mark(old, USERS.reviewerA)).json()).toEqual({ error: 'forbidden' });
      expect((await mark(old, USERS.editorA)).statusCode).toBe(204);
      expect((await mark(old, USERS.editorA)).json()).toEqual({ error: 'stale' });
      expect((await mark(crypto.randomUUID(), USERS.editorA)).statusCode).toBe(404);
      expect((await mark(old, USERS.countryAdminB)).statusCode).toBe(404);
      const sources = (await send('GET', base, USERS.reviewerA))
        .json<{ sources: { id: string; replacedAt: string | null }[] }>()
        .sources.filter((s) => made.includes(s.id));
      expect(sources.map((s) => s.id)).toEqual([newer, old]);
      expect(sources[1]?.replacedAt).toEqual(expect.any(String));
      expect(sources[0]?.replacedAt).toBeNull();
    } finally {
      await cleanUp(made);
    }
  });

  it('take an uploaded copy into the store, request its extraction, and never change after', async () => {
    const made: string[] = [];
    const bytes = Buffer.from(`%PDF-1.4 un documento de prueba ${crypto.randomUUID()}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(id);
      dispatched.length = 0;
      const uploaded = await send(
        'PUT',
        `${base}/${id}/copy?filename=programa.pdf`,
        USERS.editorA,
        bytes,
        {
          'content-type': 'application/pdf',
        },
      );
      expect(uploaded.statusCode).toBe(201);
      expect(uploaded.json()).toEqual({ sha256 });
      expect(await files.get({ tenantId: TENANT_A, bucket: 'sources' }, sha256)).toEqual(
        new Uint8Array(bytes),
      );
      expect(dispatched).toEqual([
        { jobId: expect.any(String), tenantId: TENANT_A, sha256, contentType: 'application/pdf' },
      ]);
      const [source] = (await send('GET', base, USERS.editorA))
        .json<{ sources: { id: string; copy: unknown; extractionRequested: boolean }[] }>()
        .sources.filter((s) => s.id === id);
      expect(source).toMatchObject({
        copy: { sha256, byteSize: bytes.byteLength, contentType: 'application/pdf' },
        extractionRequested: true,
        // Not citable until its text is extracted (S3.4).
        citable: false,
      });
      // The same bytes for another source are kept once: both name one file (S2.2).
      const { id: twin } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(twin);
      expect(
        (
          await send('PUT', `${base}/${twin}/copy`, USERS.editorA, bytes, {
            'content-type': 'application/pdf',
          })
        ).statusCode,
      ).toBe(201);
      const { rows: named } = await sql<{ files: number }>`
        SELECT count(DISTINCT file_id)::int AS files FROM app.source_documents
         WHERE id IN (${id}, ${twin})`.execute(owner);
      expect(named).toEqual([{ files: 1 }]);
      // The same bytes as another type: refused, never read and served as the first upload's type.
      const { id: other } = (await send('POST', base, USERS.editorA, FIELDS)).json<{
        id: string;
      }>();
      made.push(other);
      const otherType = await send('PUT', `${base}/${other}/copy`, USERS.editorA, bytes, {
        'content-type': 'text/plain',
      });
      expect(otherType.statusCode).toBe(409);
      expect(otherType.json()).toEqual({ error: 'otherType' });
      // The copy is the source now: its fields never change again (S1.2), nor its copy, refused before it is read.
      expect(
        (await send('PUT', `${base}/${id}`, USERS.editorA, { ...FIELDS, title: 'Cambio tardío' }))
          .statusCode,
      ).toBe(409);
      const before = streamed;
      const again = await send(
        'PUT',
        `${base}/${id}/copy`,
        USERS.editorA,
        Buffer.from('%PDF-1.4 otra'),
        {
          'content-type': 'application/pdf',
        },
      );
      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ error: 'hasCopy' });
      expect(streamed).toBe(before);
      // Read back as a download, never rendered on the admin's origin.
      const copy = await send('GET', `${base}/${id}/copy`, USERS.reviewerA);
      expect(copy.statusCode).toBe(200);
      expect(copy.headers['content-disposition']).toMatch(/^attachment/);
      expect(copy.headers['content-security-policy']).toContain('sandbox');
      expect(copy.rawPayload).toEqual(bytes);
      // Asking again hands the waiting job to the worker again: for those who may write sources, a few times a minute.
      dispatched.length = 0;
      expect((await send('POST', `${base}/${id}/extract`, USERS.editorA)).statusCode).toBe(202);
      expect(dispatched).toHaveLength(1);
      expect((await send('POST', `${base}/${id}/extract`, USERS.reviewerA)).statusCode).toBe(403);
      const asked = [];
      for (let i = 0; i < 11; i += 1) {
        asked.push((await send('POST', `${base}/${id}/extract`, USERS.countryAdminA)).statusCode);
      }
      expect(asked).toEqual([...Array<number>(10).fill(202), 429]);
    } finally {
      await cleanUp(made);
    }
  });

  it("hand the dispatch the open jobs a member's listing shows, with how long each has waited (ADR-0006)", async () => {
    const made: string[] = [];
    const bytes = Buffer.from(`%PDF-1.4 un documento que espera su texto ${crypto.randomUUID()}`);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(id);
      const uploaded = await send('PUT', `${base}/${id}/copy`, USERS.editorA, bytes, {
        'content-type': 'application/pdf',
      });
      expect(uploaded.statusCode).toBe(201);
      // Requested ten minutes ago, as if the worker had missed it: set by the owner, behind the job rules' back.
      await owner.transaction().execute(async (trx) => {
        await sql`ALTER TABLE app.job_requests DISABLE TRIGGER USER`.execute(trx);
        await sql`UPDATE app.job_requests SET created_at = now() - interval '10 minutes'
                   WHERE source_document_id = ${id}`.execute(trx);
        await sql`ALTER TABLE app.job_requests ENABLE TRIGGER USER`.execute(trx);
      });
      const job = {
        jobId: expect.any(String),
        tenantId: TENANT_A,
        sha256,
        contentType: 'application/pdf',
        waitedMs: expect.any(Number),
      };
      const mine = (jobs: WaitingExtraction[] | undefined) =>
        (jobs ?? []).filter((open) => open.sha256 === sha256);
      // Any member's listing will do, a reviewer's too: it reads what RLS shows them, and asks nothing new.
      listed.length = 0;
      expect((await send('GET', base, USERS.reviewerA)).statusCode).toBe(200);
      expect(mine(listed[0])).toEqual([job]);
      const [found] = mine(listed[0]);
      expect(found?.waitedMs).toBeGreaterThanOrEqual(10 * 60_000);
      expect(found?.waitedMs).toBeLessThan(11 * 60_000);
      // Another source of this election waiting too, and one of another election of the same site.
      const { id: second } = (await send('POST', base, USERS.editorA, FIELDS)).json<{
        id: string;
      }>();
      made.push(second);
      const secondBytes = Buffer.from(`%PDF-1.4 otro documento que espera ${crypto.randomUUID()}`);
      await send('PUT', `${base}/${second}/copy`, USERS.editorA, secondBytes, {
        'content-type': 'application/pdf',
      });
      const elsewhere = `/api/t/test-a/e/${LIVE_A.slug}/sources`;
      const { id: third } = (
        await send('POST', elsewhere, USERS.editorA, {
          ...FIELDS,
          partyId: null,
          isProgramme: false,
        })
      ).json<{
        id: string;
      }>();
      made.push(third);
      const thirdBytes = Buffer.from(
        `%PDF-1.4 un documento de otra elección ${crypto.randomUUID()}`,
      );
      expect(
        (
          await send('PUT', `${elsewhere}/${third}/copy`, USERS.editorA, thirdBytes, {
            'content-type': 'application/pdf',
          })
        ).statusCode,
      ).toBe(201);
      const otherElection = createHash('sha256').update(thirdBytes).digest('hex');
      listed.length = 0;
      await send('GET', base, USERS.reviewerA);
      const shas = (listed[0] ?? []).map((open) => open.sha256);
      expect(shas).toContain(sha256);
      expect(shas).toContain(createHash('sha256').update(secondBytes).digest('hex'));
      expect(shas).not.toContain(otherElection);
      // The source's own page, which an editor reloads while its text is being extracted: its job alone.
      listed.length = 0;
      expect((await send('GET', `${base}/${id}`, USERS.editorA)).statusCode).toBe(200);
      expect(listed).toEqual([[job]]);
      // Nobody outside the site gets as far as a listing, so nothing of its jobs reaches the dispatch.
      listed.length = 0;
      expect((await send('GET', base, USERS.countryAdminB)).statusCode).toBe(404);
      expect((await send('GET', base, USERS.noMembership)).statusCode).toBe(404);
      expect(listed).toEqual([]);
      // A finished job is no longer open.
      await owner.transaction().execute(async (trx) => {
        await sql`ALTER TABLE app.job_requests DISABLE TRIGGER USER`.execute(trx);
        await sql`UPDATE app.job_requests SET finished_at = now() WHERE source_document_id = ${id}`.execute(
          trx,
        );
        await sql`ALTER TABLE app.job_requests ENABLE TRIGGER USER`.execute(trx);
      });
      listed.length = 0;
      await send('GET', base, USERS.reviewerA);
      expect(mine(listed[0])).toEqual([]);
    } finally {
      await cleanUp(made);
    }
  });

  it('refuse an upload of a type no source has, or from anyone who may not write sources', async () => {
    const made: string[] = [];
    try {
      const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(id);
      const executable = await send('PUT', `${base}/${id}/copy`, USERS.editorA, Buffer.from('MZ'), {
        'content-type': 'application/x-msdownload',
      });
      expect(executable.statusCode).toBe(415);
      // A reviewer may not store a copy, nor may anyone signed out: refused before the body is read.
      const before = streamed;
      const refused = Buffer.from(`%PDF-1.4 un intento de revisión ${crypto.randomUUID()}`);
      const reviewer = await send('PUT', `${base}/${id}/copy`, USERS.reviewerA, refused, {
        'content-type': 'application/pdf',
      });
      expect(reviewer.statusCode).toBe(403);
      const signedOut = await app.inject({
        method: 'PUT',
        url: `${base}/${id}/copy`,
        headers: { origin: ORIGIN, 'content-type': 'application/pdf' },
        payload: refused,
      });
      expect(signedOut.statusCode).toBe(401);
      expect(streamed).toBe(before);
      expect(
        await files.get(
          { tenantId: TENANT_A, bucket: 'sources' },
          createHash('sha256').update(refused).digest('hex'),
        ),
      ).toBeUndefined();
      expect(
        (
          await send('PUT', `${base}/${id}/copy`, USERS.countryAdminB, Buffer.from('%PDF'), {
            'content-type': 'application/pdf',
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await cleanUp(made);
    }
  });

  it('refuse a copy larger than the limit as it streams in, keeping nothing of it', async () => {
    const made: string[] = [];
    const leftovers = async () => readdir(join(root, 'tmp')).catch(() => []);
    try {
      const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(id);
      const tooLarge = Buffer.alloc(50 * 1024 * 1024 + 1, 0x20);
      // Declared too large: refused before a byte is read.
      const declared = await send('PUT', `${base}/${id}/copy`, USERS.editorA, tooLarge, {
        'content-type': 'text/plain',
      });
      expect(declared.statusCode).toBe(413);
      expect(declared.json()).toEqual({ error: 'tooLarge' });
      // Sent in chunks with no length: refused once it passes the limit, as it streams in.
      const before = streamed;
      const chunked = await app.inject({
        method: 'PUT',
        url: `${base}/${id}/copy`,
        headers: { 'x-test-user': USERS.editorA, origin: ORIGIN, 'content-type': 'text/plain' },
        payload: Readable.from(
          (function* () {
            for (let i = 0; i < 51; i += 1) {
              yield Buffer.alloc(1024 * 1024, 0x20);
            }
          })(),
        ),
      });
      expect(chunked.statusCode).toBe(413);
      expect(chunked.json()).toEqual({ error: 'tooLarge' });
      expect(streamed).toBe(before + 1);
      expect(await leftovers()).toEqual([]);
      const { rows } = await sql<{ file_id: string | null }>`
        SELECT file_id FROM app.source_documents WHERE id = ${id}`.execute(owner);
      expect(rows).toEqual([{ file_id: null }]);
    } finally {
      await cleanUp(made);
    }
  });

  it('refuse a copy of no type they take, or no bytes at all, keeping nothing', async () => {
    const made: string[] = [];
    try {
      const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
      made.push(id);
      const json = await send('PUT', `${base}/${id}/copy`, USERS.editorA, { copia: 'no' });
      expect(json.statusCode).toBe(415);
      // A type in capitals is the same type, stored as the files table takes it.
      const capitals = await send(
        'PUT',
        `${base}/${id}/copy`,
        USERS.editorA,
        Buffer.from(`Texto en mayúsculas ${crypto.randomUUID()}`),
        { 'content-type': 'Text/Plain' },
      );
      expect(capitals.statusCode).toBe(201);
      const { id: empty } = (await send('POST', base, USERS.editorA, FIELDS)).json<{
        id: string;
      }>();
      made.push(empty);
      const nothing = await app.inject({
        method: 'PUT',
        url: `${base}/${empty}/copy`,
        headers: { 'x-test-user': USERS.editorA, origin: ORIGIN, 'content-type': 'text/plain' },
        payload: Readable.from([]),
      });
      expect(nothing.statusCode).toBe(400);
    } finally {
      await cleanUp(made);
    }
  });

  it("close a refused upload's connection within limits, rather than read it to its end", async () => {
    const server = Fastify();
    await server.register(
      adminDataRoutes({
        admin,
        files,
        adminOrigin: ORIGIN,
        actorFor: async () => undefined,
      }),
      { prefix: '/api' },
    );
    await server.listen({ host: '127.0.0.1', port: 0 });
    const { port } = server.server.address() as AddressInfo;
    try {
      // Signed out, sending without end: answered at once, then cut off within seconds.
      const outcome = await new Promise<{ status: number; closedAfterMs: number }>((resolve) => {
        const outgoing = httpRequest({
          host: '127.0.0.1',
          port,
          method: 'PUT',
          path: `${base}/${crypto.randomUUID()}/copy`,
          headers: { origin: ORIGIN, 'content-type': 'application/pdf' },
        });
        let status = 0;
        let answeredAt = 0;
        const chunk = Buffer.alloc(64 * 1024);
        const pump = () => {
          while (!outgoing.destroyed && outgoing.write(chunk)) {
            // Fill the socket until it pushes back.
          }
        };
        outgoing.on('drain', pump);
        outgoing.once('response', (response) => {
          status = response.statusCode ?? 0;
          answeredAt = Date.now();
          response.resume();
        });
        outgoing.once('error', () => undefined);
        outgoing.once('close', () => resolve({ status, closedAfterMs: Date.now() - answeredAt }));
        pump();
      });
      expect(outcome.status).toBe(401);
      expect(outcome.closedAfterMs).toBeLessThan(10_000);
    } finally {
      // Nothing is left holding the server open.
      await server.close();
    }
  }, 30_000);

  it('are deleted while nothing cites them', async () => {
    const { id } = (await send('POST', base, USERS.editorA, FIELDS)).json<{ id: string }>();
    expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(204);
    expect((await send('DELETE', `${base}/${id}`, USERS.editorA)).statusCode).toBe(404);
  });
});
