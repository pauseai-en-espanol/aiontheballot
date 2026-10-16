import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore, type FileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDataRoutes } from '../src/admin/routes.js';
import { createBrandImageSource } from '../src/home-data.js';
import { SHARED_BRAND_ASSET, TENANT_A, UNLINKED_ORGANIZATION, USERS } from './fixtures.js';
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
  root = await mkdtemp(join(tmpdir(), 'brand-routes-'));
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

/** The header of a PNG of this size (all an image's check reads), then some fictional bytes, unique per call. */
const png = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.from(`imagen de ejemplo ${randomUUID()}`)]);
};

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const put = (path: string, as: string, body: Buffer, contentType = 'image/png') =>
  app.inject({
    method: 'PUT',
    url: path,
    headers: { 'x-test-user': as, origin: ORIGIN, 'content-type': contentType },
    payload: body,
  });

const send = (method: 'GET' | 'DELETE', path: string, as: string) =>
  app.inject({
    method,
    url: path,
    headers: { 'x-test-user': as, ...(method === 'GET' ? {} : { origin: ORIGIN }) },
  });

/** A slot no fixture selects, so these tests leave the others' selections as they are. */
const MARK = '/api/t/test-a/brand/operator_mark';
const ICON = '/api/t/test-a/brand/site_icon';
const INVERSE = '/api/t/test-a/brand/operator_logo_on_inverse';

const selection = async (slot: string) =>
  (
    await sql<{ file: string | null; asset: string | null }>`
      SELECT file_id AS file, brand_asset_id AS asset FROM app.tenant_brand_selections
       WHERE tenant_id = ${TENANT_A} AND slot = ${slot}`.execute(owner)
  ).rows[0];

const fileExists = async (id: string) =>
  (await sql`SELECT 1 FROM app.files WHERE id = ${id}`.execute(owner)).rows.length === 1;

const unselect = (...slots: string[]) =>
  sql`DELETE FROM app.tenant_brand_selections
       WHERE tenant_id = ${TENANT_A} AND slot = ANY (${slots})`.execute(owner);

/** What the public site would serve for these bytes: read as the public role, as it reads them (home-data.ts). */
const servedPublicly = (sha256: string) =>
  owner.transaction().execute(async (trx) => {
    await sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);
    return createBrandImageSource(trx, files)('test-a', sha256);
  });

describe("a site's brand images (admin forms §2, settings; PLAN R195)", () => {
  it('are uploaded by a country admin, shown to members, served by the public site, replaced and removed', async () => {
    try {
      const first = png(400, 120);
      const uploaded = await put(MARK, USERS.countryAdminA, first);
      expect(uploaded.statusCode).toBe(201);
      expect(uploaded.json()).toEqual({ sha256: sha256Of(first) });
      const firstFile = (await selection('operator_mark'))?.file ?? '';
      expect(firstFile).not.toBe('');
      // Every member reads the slots, and sees the image itself, never as anything a browser would run.
      const listed = await send('GET', '/api/t/test-a/brand', USERS.reviewerA);
      expect(listed.statusCode).toBe(200);
      const slots = listed.json<{
        slots: { slot: string; file: { id: string; contentType: string } | null; asset: unknown }[];
        canEdit: boolean;
      }>();
      expect(slots.canEdit).toBe(false);
      expect(slots.slots.map((s) => s.slot)).toEqual([
        'operator_logo_on_accent',
        'operator_logo_on_canvas',
        'operator_logo_on_inverse',
        'operator_mark',
        'site_icon',
      ]);
      expect(slots.slots.find((s) => s.slot === 'operator_mark')).toEqual({
        slot: 'operator_mark',
        file: { id: firstFile, contentType: 'image/png' },
        asset: null,
      });
      const shown = await send('GET', `/api/t/test-a/images/${firstFile}`, USERS.reviewerA);
      expect(shown.statusCode).toBe(200);
      expect(shown.headers['x-content-type-options']).toBe('nosniff');
      expect(shown.rawPayload).toEqual(first);
      // The public site serves it, as the public role reads it: the site selects it.
      expect(await servedPublicly(sha256Of(first))).toEqual({
        contentType: 'image/png',
        content: new Uint8Array(first),
      });
      // Replaced: the old file, which nothing else names, goes, so the sweep can remove its bytes in time.
      const second = png(64, 64);
      expect((await put(MARK, USERS.platformAdmin, second)).statusCode).toBe(201);
      expect(await fileExists(firstFile)).toBe(false);
      expect(await servedPublicly(sha256Of(first))).toBeUndefined();
      // Removed: no selection, its file gone too, and the public site serves nothing for it.
      const secondFile = (await selection('operator_mark'))?.file ?? '';
      expect((await send('DELETE', MARK, USERS.countryAdminA)).statusCode).toBe(204);
      expect(await selection('operator_mark')).toBeUndefined();
      expect(await fileExists(secondFile)).toBe(false);
      expect(await servedPublicly(sha256Of(second))).toBeUndefined();
    } finally {
      await unselect('operator_mark');
    }
  });

  it('say which platform image a slot names, and leave that image as it is when an upload replaces it', async () => {
    try {
      await sql`INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id)
                VALUES (${TENANT_A}, 'operator_logo_on_inverse', ${SHARED_BRAND_ASSET})`.execute(
        owner,
      );
      const listed = await send('GET', '/api/t/test-a/brand', USERS.countryAdminA);
      expect(listed.json<{ canEdit: boolean }>().canEdit).toBe(true);
      expect(
        listed
          .json<{ slots: { slot: string; file: unknown; asset: unknown }[] }>()
          .slots.find((s) => s.slot === 'operator_logo_on_inverse'),
      ).toEqual({
        slot: 'operator_logo_on_inverse',
        file: null,
        asset: { name: expect.any(String) },
      });
      // The platform set it: a site's own upload replaces it, but the site can't empty it (the review of R195).
      expect((await send('DELETE', INVERSE, USERS.countryAdminA)).statusCode).toBe(403);
      expect(await selection('operator_logo_on_inverse')).toEqual({
        file: null,
        asset: SHARED_BRAND_ASSET,
      });
      expect((await put(INVERSE, USERS.countryAdminA, png(80, 80))).statusCode).toBe(201);
      expect(await selection('operator_logo_on_inverse')).toEqual({
        file: expect.any(String),
        asset: null,
      });
      expect(
        (await sql`SELECT 1 FROM app.brand_assets WHERE id = ${SHARED_BRAND_ASSET}`.execute(owner))
          .rows,
      ).toHaveLength(1);
    } finally {
      await unselect('operator_logo_on_inverse');
    }
  });

  it("are changed only by the site's country admins and platform admins, refused before anything is stored", async () => {
    const stored = (await files.list()).stored.length;
    for (const user of [USERS.editorA, USERS.reviewerA]) {
      const refused = await put(ICON, user, png(512, 512));
      expect(refused.statusCode).toBe(403);
      expect((await send('DELETE', ICON, user)).statusCode).toBe(403);
    }
    // Another site's country admin finds no such site.
    expect((await put(ICON, USERS.countryAdminB, png(512, 512))).statusCode).toBe(404);
    expect((await send('DELETE', ICON, USERS.countryAdminB)).statusCode).toBe(404);
    expect((await send('GET', '/api/t/test-a/brand', USERS.countryAdminB)).statusCode).toBe(404);
    expect((await files.list()).stored.length).toBe(stored);
    expect(await selection('site_icon')).toBeUndefined();
  });

  it('take only a PNG, JPEG or WebP that is what it says, within its limits, into a slot the site has', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const refusals = [
      await put(ICON, USERS.countryAdminA, svg, 'image/svg+xml'),
      // Declared a JPEG, but its bytes are a PNG's.
      await put(ICON, USERS.countryAdminA, png(100, 100), 'image/jpeg'),
      await put(ICON, USERS.countryAdminA, Buffer.from('no es una imagen')),
      await put(ICON, USERS.countryAdminA, png(5000, 100)),
    ];
    expect(refusals.map((r) => r.statusCode)).toEqual([415, 415, 415, 415]);
    const large = await put(
      ICON,
      USERS.countryAdminA,
      Buffer.concat([png(100, 100), Buffer.alloc(2 * 1024 * 1024)]),
    );
    expect(large.statusCode).toBe(413);
    expect(
      (await put('/api/t/test-a/brand/product_logo', USERS.countryAdminA, png(10, 10))).statusCode,
    ).toBe(400);
    expect(await selection('site_icon')).toBeUndefined();
  });

  it('take as the site icon only a square PNG, 512 to 1,024 pixels a side (T1.4)', async () => {
    try {
      for (const [width, height] of [
        [600, 400],
        [256, 256],
        [2048, 2048],
      ] as const) {
        const refused = await put(ICON, USERS.countryAdminA, png(width, height));
        expect([refused.statusCode, refused.json()]).toEqual([422, { error: 'siteIcon' }]);
      }
      expect(await selection('site_icon')).toBeUndefined();
      expect((await put(ICON, USERS.countryAdminA, png(512, 512))).statusCode).toBe(201);
      // Any other slot takes any shape.
      expect((await put(MARK, USERS.countryAdminA, png(600, 400))).statusCode).toBe(201);
    } finally {
      await unselect('site_icon', 'operator_mark');
    }
  });
});

describe("an organization's logo (admin forms §2, settings and platform; PLAN R195)", () => {
  const logo = `/api/organizations/${UNLINKED_ORGANIZATION}/logo`;
  const logoOf = async () =>
    (
      await sql<{ asset: string | null }>`
        SELECT logo_asset_id AS asset FROM app.organizations WHERE id = ${UNLINKED_ORGANIZATION}`.execute(
        owner,
      )
    ).rows[0]?.asset ?? null;

  it("is set by a platform admin, among the platform's images, shown to them, and removed", async () => {
    const before = await logoOf();
    const made: string[] = [];
    try {
      const image = png(300, 300);
      const uploaded = await put(logo, USERS.platformAdmin, image);
      expect(uploaded.statusCode).toBe(201);
      expect(uploaded.json()).toEqual({ sha256: sha256Of(image) });
      const asset = await logoOf();
      expect(asset).not.toBeNull();
      made.push(asset ?? '');
      const { rows } = await sql<{ restricted: boolean; sha256: string; name: string }>`
        SELECT restricted, sha256, name FROM app.brand_assets WHERE id = ${asset}`.execute(owner);
      expect(rows[0]).toMatchObject({ restricted: false, sha256: sha256Of(image) });
      // Named neutrally: every site's members see the catalogue's names.
      expect(rows[0]?.name).toBe(`organization-logo-${UNLINKED_ORGANIZATION}`);
      // Its bytes are the platform's, not any site's.
      expect(await files.get('platform', sha256Of(image))).toEqual(new Uint8Array(image));
      const shown = await send('GET', logo, USERS.platformAdmin);
      expect(shown.statusCode).toBe(200);
      expect(shown.headers['content-type']).toBe('image/png');
      expect(shown.rawPayload).toEqual(image);
      // The same bytes again are the same platform image.
      expect((await put(logo, USERS.platformAdmin, image)).statusCode).toBe(201);
      expect(await logoOf()).toBe(asset);
      // Removed: the organization has none; the image stays in the platform's catalogue.
      expect((await send('DELETE', logo, USERS.platformAdmin)).statusCode).toBe(204);
      expect(await logoOf()).toBeNull();
      expect(
        (await sql`SELECT 1 FROM app.brand_assets WHERE id = ${asset}`.execute(owner)).rows,
      ).toHaveLength(1);
    } finally {
      await sql`UPDATE app.organizations SET logo_asset_id = ${before}
                 WHERE id = ${UNLINKED_ORGANIZATION}`.execute(owner);
      if (made.length > 0) {
        await sql`DELETE FROM app.brand_assets WHERE id = ANY (${made})`.execute(owner);
      }
    }
  });

  it("is a restricted image of the platform's when its bytes are one, so only a PauseAI chapter takes it", async () => {
    // The review of R195: never an unrestricted copy of a restricted brand asset.
    const before = await logoOf();
    const image = png(320, 320);
    const restricted = (
      await sql<{ id: string }>`
        INSERT INTO app.brand_assets (name, restricted, content_type, sha256, byte_size)
        VALUES ('Logotipo restringido de ejemplo', true, 'image/png', ${sha256Of(image)}, ${image.byteLength})
        RETURNING id`.execute(owner)
    ).rows[0]?.id;
    try {
      const refused = await put(logo, USERS.platformAdmin, image);
      expect([refused.statusCode, refused.json()]).toEqual([422, { error: 'restrictedAsset' }]);
      expect(await logoOf()).toBe(before);
      await sql`UPDATE app.organizations SET is_pauseai_chapter = true
                 WHERE id = ${UNLINKED_ORGANIZATION}`.execute(owner);
      expect((await put(logo, USERS.platformAdmin, image)).statusCode).toBe(201);
      expect(await logoOf()).toBe(restricted);
      const { rows } = await sql<{ restricted: boolean }>`
        SELECT restricted FROM app.brand_assets WHERE sha256 = ${sha256Of(image)}`.execute(owner);
      expect(rows).toEqual([{ restricted: true }]);
    } finally {
      await sql`UPDATE app.organizations SET logo_asset_id = ${before}, is_pauseai_chapter = false
                 WHERE id = ${UNLINKED_ORGANIZATION}`.execute(owner);
      await sql`DELETE FROM app.brand_assets WHERE id = ${restricted}`.execute(owner);
    }
  });

  it('is refused when a restricted image of the same bytes has another type, never a copy of it', async () => {
    // The reviews of R200: the bytes make the image, whatever type a row says they are; served as the wrong type, a
    // logo would be broken, and an unrestricted copy would be the way around the restriction.
    const before = await logoOf();
    const image = png(330, 330);
    const restricted = (
      await sql<{ id: string }>`
        INSERT INTO app.brand_assets (name, restricted, content_type, sha256, byte_size)
        VALUES ('Logotipo restringido de ejemplo', true, 'image/jpeg', ${sha256Of(image)}, ${image.byteLength})
        RETURNING id`.execute(owner)
    ).rows[0]?.id;
    try {
      await sql`UPDATE app.organizations SET is_pauseai_chapter = true
                 WHERE id = ${UNLINKED_ORGANIZATION}`.execute(owner);
      const refused = await put(logo, USERS.platformAdmin, image);
      expect([refused.statusCode, refused.json()]).toEqual([409, { error: 'otherType' }]);
      expect(await logoOf()).toBe(before);
      const { rows } = await sql<{ id: string }>`
        SELECT id FROM app.brand_assets WHERE sha256 = ${sha256Of(image)}`.execute(owner);
      expect(rows).toEqual([{ id: restricted }]);
    } finally {
      await sql`UPDATE app.organizations SET logo_asset_id = ${before}, is_pauseai_chapter = false
                 WHERE id = ${UNLINKED_ORGANIZATION}`.execute(owner);
      await sql`DELETE FROM app.brand_assets WHERE id = ${restricted}`.execute(owner);
    }
  });

  it("is a platform admin's only: anyone else finds no such page, and nothing is stored", async () => {
    const stored = (await files.list()).stored.length;
    for (const user of [USERS.countryAdminA, USERS.editorA]) {
      expect((await put(logo, user, png(50, 50))).statusCode).toBe(404);
      expect((await send('GET', logo, user)).statusCode).toBe(404);
      expect((await send('DELETE', logo, user)).statusCode).toBe(404);
    }
    expect((await files.list()).stored.length).toBe(stored);
    expect((await put(logo, USERS.platformAdmin, Buffer.from('no es una imagen'))).statusCode).toBe(
      415,
    );
  });
});
