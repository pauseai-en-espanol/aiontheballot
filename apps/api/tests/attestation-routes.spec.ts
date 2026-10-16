import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore, type FileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
let root: string;
let app: FastifyInstance;
/** How many uploads reached the store: a refused one never does, its body unread. */
let streamed = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'attestations-'));
  const store = createFileStore(root);
  const files: FileStore = {
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

/** A 1×1 PNG: a fictional screenshot. */
const SCREENSHOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// A's draft election, whose cells and sources are the tests' own: a cell by editor A quoting a scanned document and,
// for contrast, a page with text, each committed by the owner as the editor would leave them, and removed after.
const draft = ELECTIONS_A.draft;
const [PARTY] = draft.parties;
const [CRITERION] = draft.criteria;
const cells = `/api/t/test-a/e/${draft.slug}/cells`;

const setUp = async () => {
  const one = async (query: ReturnType<typeof sql<{ id: string }>>) =>
    (await query.execute(owner)).rows[0]?.id ?? '';
  await sql`SELECT set_config('app.user_id', ${USERS.editorA}, false)`.execute(owner);
  const file = await one(sql<{ id: string }>`
    INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
    VALUES (${TENANT_A}, 'sources', 'application/pdf', 4, encode(sha256(convert_to(${`escaneo de prueba ${crypto.randomUUID()}`}, 'UTF8')), 'hex'),
            'escaneo.pdf')
    RETURNING id`);
  const sources: string[] = [];
  for (const [title, status] of [
    ['Escaneo de prueba', 'not_applicable'],
    ['Página de prueba', 'pending'],
  ] as const) {
    const id = await one(sql<{ id: string }>`
      INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
      VALUES (${TENANT_A}, ${draft.id}, 'pdf', ${title}) RETURNING id`);
    await sql`UPDATE app.source_documents SET file_id = ${file}, file_origin = 'uploaded' WHERE id = ${id}`.execute(
      owner,
    );
    if (status === 'not_applicable') {
      await sql`UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = ${id}`.execute(
        owner,
      );
    } else {
      // Done: a source with text, whose quotes are matched (its text needs no rows for that).
      await sql`UPDATE app.source_documents SET extraction_status = 'done' WHERE id = ${id}`.execute(
        owner,
      );
    }
    sources.push(id);
  }
  const cell = await one(sql<{ id: string }>`
    INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
    VALUES (${TENANT_A}, ${draft.id}, ${PARTY}, ${CRITERION}, 'meets', '{"es": "Resumen de prueba"}')
    RETURNING id`);
  const scanned = await one(sql<{ id: string }>`
    INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
    VALUES (${TENANT_A}, ${draft.id}, ${cell}, ${sources[0]}, 1, 'Una frase escaneada de prueba')
    RETURNING id`);
  const matched = await one(sql<{ id: string }>`
    INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
    VALUES (${TENANT_A}, ${draft.id}, ${cell}, ${sources[1]}, 2, 'Una frase de prueba con texto')
    RETURNING id`);
  return { cell, scanned, matched, sources, file };
};

const tearDown = async ({ cell, sources }: { cell: string; sources: string[] }) => {
  await sql`DELETE FROM app.assessments WHERE id = ${cell}`.execute(owner);
  const { rows } = await sql<{ file_id: string }>`
    SELECT DISTINCT file_id FROM app.source_documents WHERE id = ANY (${sources})`.execute(owner);
  await sql`DELETE FROM app.source_documents WHERE id = ANY (${sources})`.execute(owner);
  await sql`DELETE FROM app.files WHERE id = ANY (${rows.map((r) => r.file_id)})
              OR (tenant_id = ${TENANT_A} AND content_type = 'image/png' AND original_filename = 'captura.png'
                  AND NOT EXISTS (SELECT 1 FROM app.draft_evidence e WHERE e.attestation_file_id = files.id))`.execute(
    owner,
  );
};

const versionOf = async (cell: string) =>
  (
    await sql<{
      v: number;
    }>`SELECT content_version AS v FROM app.assessments WHERE id = ${cell}`.execute(owner)
  ).rows[0]?.v ?? -1;

describe('attested quotes over HTTP (C4, PLAN R171)', () => {
  it('refuse before reading a byte what could never be stored', async () => {
    const made = await setUp();
    try {
      const file = (quote: string, version: number) =>
        `${cells}/${made.cell}/quotes/${quote}/attestation/file?version=${version}&filename=captura.png`;
      const version = await versionOf(made.cell);
      const before = streamed;
      const png = { 'content-type': 'image/png' };
      for (const type of ['image/svg+xml', 'text/html', 'application/pdf']) {
        const refused = await send('PUT', file(made.scanned, version), USERS.editorA, SCREENSHOT, {
          'content-type': type,
        });
        expect(refused.statusCode, type).toBe(415);
      }
      expect(
        (await send('PUT', file(made.scanned, version), USERS.reviewerA, SCREENSHOT, png)).json(),
      ).toEqual({
        error: 'forbidden',
      });
      expect(
        (await send('PUT', file(made.scanned, version - 1), USERS.editorA, SCREENSHOT, png)).json(),
      ).toEqual({ error: 'cellChanged' });
      // A quote from a source with text is matched: a screenshot would vouch for nothing.
      expect(
        (await send('PUT', file(made.matched, version), USERS.editorA, SCREENSHOT, png)).statusCode,
      ).toBe(422);
      expect(
        (await send('PUT', file(crypto.randomUUID(), version), USERS.editorA, SCREENSHOT, png))
          .statusCode,
      ).toBe(404);
      expect(
        (await send('PUT', file(made.scanned, version), USERS.countryAdminB, SCREENSHOT, png))
          .statusCode,
      ).toBe(404);
      expect(streamed).toBe(before);
    } finally {
      await tearDown(made);
    }
  });

  it('store a screenshot, serve it only as a download, and take an attestation and its withdrawal', async () => {
    const made = await setUp();
    try {
      const quote = `${cells}/${made.cell}/quotes/${made.scanned}`;
      const stored = await send(
        'PUT',
        `${quote}/attestation/file?version=${await versionOf(made.cell)}&filename=captura.png`,
        USERS.editorA,
        SCREENSHOT,
        { 'content-type': 'image/png' },
      );
      expect(stored.statusCode).toBe(201);
      const download = await send('GET', `${quote}/attestation/file`, USERS.reviewerA);
      expect(download.statusCode).toBe(200);
      expect(download.headers).toMatchObject({
        'content-type': 'image/png',
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      });
      expect(download.headers['content-disposition']).toMatch(
        /^attachment; filename="[0-9a-f]{12}\.png"$/u,
      );
      expect(download.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(download.rawPayload, SCREENSHOT)).toBe(0);
      expect((await send('GET', `${quote}/attestation/file`, USERS.countryAdminB)).statusCode).toBe(
        404,
      );

      const version = await versionOf(made.cell);
      expect(
        (
          await send('POST', `${quote}/attestation`, USERS.reviewerA, { version: version - 1 })
        ).json(),
      ).toEqual({ error: 'cellChanged' });
      expect(
        (await send('POST', `${quote}/attestation`, USERS.reviewerA, { version })).json(),
      ).toEqual({ version });
      // The editor who wrote it and stored the screenshot is refused by the database.
      expect((await send('DELETE', `${quote}/attestation`, USERS.reviewerA)).statusCode).toBe(204);
      expect(
        (await send('POST', `${quote}/attestation`, USERS.editorA, { version })).statusCode,
      ).toBe(403);
    } finally {
      await tearDown(made);
    }
  });

  it("answer a change of the cell's content with the version it left the cell at (admin forms §2, PLAN R190)", async () => {
    // What the cell page adopts as its own change, so the text being typed in its draft isn't taken for stale.
    const made = await setUp();
    try {
      const before = await versionOf(made.cell);
      const stored = await send(
        'PUT',
        `${cells}/${made.cell}/quotes/${made.scanned}/attestation/file?version=${before}&filename=captura.png`,
        USERS.editorA,
        SCREENSHOT,
        { 'content-type': 'image/png' },
      );
      expect(stored.statusCode).toBe(201);
      const afterFile = await versionOf(made.cell);
      expect(stored.json()).toEqual({ sha256: expect.any(String), version: afterFile });
      const removed = await send(
        'DELETE',
        `${cells}/${made.cell}/quotes/${made.matched}?version=${afterFile}`,
        USERS.editorA,
      );
      expect(removed.statusCode).toBe(200);
      const afterRemoval = await versionOf(made.cell);
      expect(afterRemoval).toBeGreaterThan(afterFile);
      expect(removed.json()).toEqual({ version: afterRemoval });
      // A save of the draft says the version it is saved at, which the page submits next.
      const saved = await send('PUT', `${cells}/${made.cell}`, USERS.editorA, {
        version: afterRemoval,
        rating: 'meets',
        summary: { es: 'Resumen de prueba, cambiado' },
        changeKind: null,
        publicNote: null,
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ version: await versionOf(made.cell) });
      expect(await versionOf(made.cell)).toBeGreaterThan(afterRemoval);
    } finally {
      await tearDown(made);
    }
  });

  it('take clip times only for a quote from a video or audio source', async () => {
    const made = await setUp();
    try {
      const version = await versionOf(made.cell);
      const clip = await send(
        'PATCH',
        `${cells}/${made.cell}/quotes/${made.scanned}`,
        USERS.editorA,
        {
          version,
          clip: { start: 1, end: 2 },
        },
      );
      expect(clip.statusCode).toBe(422);
      expect(clip.json()).toEqual({ error: 'invalid' });
    } finally {
      await tearDown(made);
    }
  });
});
