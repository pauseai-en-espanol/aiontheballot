import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore, type FileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
let files: FileStore;
let app: FastifyInstance;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'party-logos-'));
  files = createFileStore(root);
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

/** The header of a PNG of this size (all a logo's check reads), then some fictional bytes, unique per call. */
const png = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.from(`logotipo de ejemplo ${randomUUID()}`)]);
};

const put = (path: string, as: string, body: Buffer, contentType = 'image/png') =>
  app.inject({
    method: 'PUT',
    url: path,
    headers: { 'x-test-user': as, origin: ORIGIN, 'content-type': contentType },
    payload: body,
  });

const draftParty = ELECTIONS_A.draft.parties[0];
const draftLogo = `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/parties/${draftParty}/logo`;
const liveLogo = `/api/t/test-a/e/${ELECTIONS_A.live.slug}/parties/${ELECTIONS_A.live.parties[0]}/logo`;

const logoOf = async (party: string) =>
  (
    await sql<{
      file: string | null;
    }>`SELECT logo_file_id AS file FROM app.parties WHERE id = ${party}`.execute(owner)
  ).rows[0]?.file ?? null;

const fileExists = async (id: string) =>
  (await sql`SELECT 1 FROM app.files WHERE id = ${id}`.execute(owner)).rows.length === 1;

describe("a party's logo (PLAN R142)", () => {
  it('is uploaded, shown to members, replaced and removed while the election is a draft', async () => {
    try {
      const first = png(300, 120);
      const uploaded = await put(draftLogo, USERS.editorA, first);
      expect(uploaded.statusCode).toBe(201);
      const sha256 = createHash('sha256').update(first).digest('hex');
      expect(uploaded.json()).toEqual({ sha256 });
      const firstFile = await logoOf(draftParty);
      expect(firstFile).not.toBeNull();
      // Every member sees it, as the image it is, and never anything a browser would run.
      const shown = await app.inject({
        method: 'GET',
        url: draftLogo,
        headers: { 'x-test-user': USERS.reviewerA },
      });
      expect(shown.statusCode).toBe(200);
      expect(shown.headers['content-type']).toBe('image/png');
      expect(shown.headers['x-content-type-options']).toBe('nosniff');
      expect(shown.rawPayload).toEqual(first);
      const list = await app.inject({
        method: 'GET',
        url: `/api/t/test-a/e/${ELECTIONS_A.draft.slug}/parties`,
        headers: { 'x-test-user': USERS.editorA },
      });
      expect(
        list
          .json<{ parties: { id: string; logo: unknown }[] }>()
          .parties.find((p) => p.id === draftParty)?.logo,
      ).toEqual({ id: firstFile, sha256, contentType: 'image/png' });
      // Replaced: the old file row, which nothing else names, goes, so the sweep can remove its bytes in time.
      expect((await put(draftLogo, USERS.editorA, png(64, 64))).statusCode).toBe(201);
      expect(await fileExists(firstFile ?? '')).toBe(false);
      // Removed: the party has none, and its file goes too.
      const secondFile = await logoOf(draftParty);
      const removed = await app.inject({
        method: 'DELETE',
        url: draftLogo,
        headers: { 'x-test-user': USERS.editorA, origin: ORIGIN },
      });
      expect(removed.statusCode).toBe(204);
      expect(await logoOf(draftParty)).toBeNull();
      expect(await fileExists(secondFile ?? '')).toBe(false);
    } finally {
      await sql`UPDATE app.parties SET logo_file_id = NULL WHERE id = ${draftParty}`.execute(owner);
    }
  });

  it("keeps a file another party still names when it's replaced", async () => {
    const shared = png(100, 100);
    const other = ELECTIONS_A.draft.parties[1];
    const otherLogo = draftLogo.replace(draftParty, other);
    try {
      expect((await put(draftLogo, USERS.editorA, shared)).statusCode).toBe(201);
      expect((await put(otherLogo, USERS.editorA, shared)).statusCode).toBe(201);
      const file = await logoOf(draftParty);
      // The same bytes are one file, named by both.
      expect(await logoOf(other)).toBe(file);
      expect((await put(draftLogo, USERS.editorA, png(80, 80))).statusCode).toBe(201);
      expect(await fileExists(file ?? '')).toBe(true);
    } finally {
      await sql`UPDATE app.parties SET logo_file_id = NULL WHERE id IN (${draftParty}, ${other})`.execute(
        owner,
      );
    }
  });

  it("keeps a file a pending change request proposes as a live party's logo", async () => {
    try {
      expect((await put(draftLogo, USERS.editorA, png(90, 90))).statusCode).toBe(201);
      const file = await logoOf(draftParty);
      await owner.transaction().execute(async (trx) => {
        await sql`SELECT set_config('app.user_id', ${USERS.editorA}, true), set_config('app.aal', '2', true)`.execute(
          trx,
        );
        await sql`
          INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                           proposed_value, public_note)
          VALUES (${TENANT_A}, ${ELECTIONS_A.live.id}, 'update', 'party', ${ELECTIONS_A.live.parties[0]},
                  'logo_file_id', to_jsonb(${file}::text), '{"es": "Nota inventada."}')`.execute(
          trx,
        );
      });
      const removed = await app.inject({
        method: 'DELETE',
        url: draftLogo,
        headers: { 'x-test-user': USERS.editorA, origin: ORIGIN },
      });
      expect(removed.statusCode).toBe(204);
      expect(await fileExists(file ?? '')).toBe(true);
    } finally {
      await sql`DELETE FROM app.change_requests WHERE field = 'logo_file_id' AND state = 'pending'`.execute(
        owner,
      );
      await sql`UPDATE app.parties SET logo_file_id = NULL WHERE id = ${draftParty}`.execute(owner);
    }
  });

  it('takes a few dozen uploads an hour from a member, no more', async () => {
    try {
      const answers: number[] = [];
      for (let i = 0; i < 31; i += 1) {
        answers.push((await put(draftLogo, USERS.countryAdminA, png(20 + i, 20))).statusCode);
      }
      expect(answers).toEqual([...Array<number>(30).fill(201), 429]);
    } finally {
      await sql`UPDATE app.parties SET logo_file_id = NULL WHERE id = ${draftParty}`.execute(owner);
    }
  });

  it('is refused anything but a PNG, JPEG or WebP that is what it says, within its limits', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const refusals = [
      await put(draftLogo, USERS.editorA, svg, 'image/svg+xml'),
      // Declared a JPEG, but its bytes are a PNG's.
      await put(draftLogo, USERS.editorA, png(100, 100), 'image/jpeg'),
      await put(draftLogo, USERS.editorA, Buffer.from('no es una imagen')),
      await put(draftLogo, USERS.editorA, png(5000, 100)),
    ];
    expect(refusals.map((r) => r.statusCode)).toEqual([415, 415, 415, 415]);
    expect(refusals.slice(1).map((r) => r.json<{ error: string }>().error)).toEqual([
      'logoImage',
      'logoImage',
      'logoImage',
    ]);
    const large = await put(
      draftLogo,
      USERS.editorA,
      Buffer.concat([png(100, 100), Buffer.alloc(2 * 1024 * 1024)]),
    );
    expect(large.statusCode).toBe(413);
    // Sent in chunks with no length: refused as soon as it passes the limit.
    const chunked = await app.inject({
      method: 'PUT',
      url: draftLogo,
      headers: { 'x-test-user': USERS.editorA, origin: ORIGIN, 'content-type': 'image/png' },
      payload: Readable.from([png(100, 100), Buffer.alloc(1024 * 1024), Buffer.alloc(1024 * 1024)]),
    });
    expect(chunked.statusCode).toBe(413);
    expect(await logoOf(draftParty)).toBeNull();
  });

  it('is changed only by those who write structure, and never directly once the election is live', async () => {
    // Refused before anything is stored, bytes included.
    const stored = (await files.list()).stored.length;
    expect((await put(draftLogo, USERS.reviewerA, png(10, 10))).statusCode).toBe(403);
    expect((await put(draftLogo, USERS.countryAdminB, png(10, 10))).statusCode).toBe(404);
    expect((await files.list()).stored.length).toBe(stored);
    const before = await logoOf(ELECTIONS_A.live.parties[0]);
    const live = await put(liveLogo, USERS.editorA, png(10, 10));
    expect(live.statusCode).toBe(409);
    expect(live.json()).toEqual({ error: 'changeControlled' });
    expect(await logoOf(ELECTIONS_A.live.parties[0])).toBe(before);
  });
});
