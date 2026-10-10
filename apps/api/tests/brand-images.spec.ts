import type { Database } from '@aiontheballot/db/client';

import { createFileStore, type FileSpace, type FileStore } from '@aiontheballot/db/file-store';
import { sql } from 'kysely';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBrandImageSource } from '../src/home-data.js';
import { inRolledBackTransaction } from './db.js';

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const tenantId = async (db: Database, slug: string): Promise<string> =>
  (
    await db
      .selectFrom('app.tenants')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirstOrThrow()
  ).id;

/** A file row, written as the superuser (the fixtures' platform admin acts), and its bytes in the row's own space. */
const storeFile = async (
  db: Database,
  store: FileStore,
  file: {
    tenantId: string;
    bucket: 'public_assets' | 'sources';
    contentType: string;
    bytes: Uint8Array;
  },
  options: { bytesIn?: FileSpace } = {},
): Promise<{ id: string; sha256: string }> => {
  const sha256 = await store.put(options.bytesIn ?? file, file.bytes);
  const { id } = await db
    .insertInto('app.files')
    .values({
      tenant_id: file.tenantId,
      bucket: file.bucket,
      content_type: file.contentType,
      byte_size: file.bytes.byteLength,
      sha256,
      created_by: '00000000-0000-0000-0000-000000000000',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id, sha256 };
};

const select = (db: Database, tenant: string, slot: string, fileId: string) =>
  db
    .insertInto('app.tenant_brand_selections')
    .values({ tenant_id: tenant, slot, file_id: fileId })
    .execute();

const asPublic = (db: Database) => sql`SET LOCAL ROLE aiontheballot_web`.execute(db);

describe('brand images', () => {
  let root: string;
  let store: FileStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'brand-images-'));
    store = createFileStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("serves a tenant's selected upload from its own public_assets bucket", async () => {
    await inRolledBackTransaction(async (db) => {
      await sql`SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`.execute(
        db,
      );
      const a = await tenantId(db, 'test-a');
      const bytes = new TextEncoder().encode('logo de ejemplo A');
      const logo = await storeFile(db, store, {
        tenantId: a,
        bucket: 'public_assets',
        contentType: 'image/png',
        bytes,
      });
      await select(db, a, 'operator_mark', logo.id);
      await asPublic(db);
      expect(await createBrandImageSource(db, store)('test-a', logo.sha256)).toEqual({
        contentType: 'image/png',
        content: bytes,
      });
    });
  });

  it("never serves another tenant's bytes to a row that names their hash", async () => {
    await inRolledBackTransaction(async (db) => {
      await sql`SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`.execute(
        db,
      );
      const [a, b] = [await tenantId(db, 'test-a'), await tenantId(db, 'test-b')];
      // A's private programme, whose hash the public can read once a revision cites it.
      const programme = await storeFile(db, store, {
        tenantId: a,
        bucket: 'sources',
        contentType: 'application/pdf',
        bytes: new TextEncoder().encode('programa privado de ejemplo'),
      });
      // B, which may write its own files rows, names that hash as an image of its own and shows it.
      const { id } = await db
        .insertInto('app.files')
        .values({
          tenant_id: b,
          bucket: 'public_assets',
          content_type: 'image/png',
          byte_size: 27,
          sha256: programme.sha256,
          created_by: '00000000-0000-0000-0000-000000000000',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await select(db, b, 'operator_mark', id);
      await asPublic(db);
      const source = createBrandImageSource(db, store);
      expect(await source('test-b', programme.sha256)).toBeUndefined();
      // The control: B's row is visible to the public, and serves bytes from B's own space once B stores them.
      const own = new TextEncoder().encode('programa privado de ejemplo');
      await store.put({ tenantId: b, bucket: 'public_assets' }, own);
      expect(await source('test-b', programme.sha256)).toEqual({
        contentType: 'image/png',
        content: own,
      });
    });
  });

  it("never serves a private bucket's bytes through a public row of the same tenant", async () => {
    await inRolledBackTransaction(async (db) => {
      await sql`SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`.execute(
        db,
      );
      const a = await tenantId(db, 'test-a');
      const bytes = new TextEncoder().encode('captura privada de ejemplo');
      // The bytes exist only in A's sources bucket; the public_assets row names them by hash.
      const image = await storeFile(
        db,
        store,
        { tenantId: a, bucket: 'public_assets', contentType: 'image/png', bytes },
        { bytesIn: { tenantId: a, bucket: 'sources' } },
      );
      await select(db, a, 'operator_mark', image.id);
      await asPublic(db);
      expect(await createBrandImageSource(db, store)('test-a', image.sha256)).toBeUndefined();
    });
  });

  it("serves a selected platform brand asset from the platform's space only", async () => {
    await inRolledBackTransaction(async (db) => {
      const bytes = new TextEncoder().encode('marca de plataforma de ejemplo');
      const sha256 = sha256Of(bytes);
      const a = await tenantId(db, 'test-a');
      const asset = await db
        .insertInto('app.brand_assets')
        .values({
          name: 'Marca de ejemplo',
          content_type: 'image/png',
          sha256,
          byte_size: bytes.byteLength,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db
        .insertInto('app.tenant_brand_selections')
        .values({ tenant_id: a, slot: 'operator_mark', brand_asset_id: asset.id })
        .execute();
      await store.put({ tenantId: a, bucket: 'public_assets' }, bytes);
      await asPublic(db);
      const source = createBrandImageSource(db, store);
      // Bytes of the same hash in a tenant's space don't stand in for the platform's.
      expect(await source('test-a', sha256)).toBeUndefined();
      await store.put('platform', bytes);
      expect(await source('test-a', sha256)).toEqual({ contentType: 'image/png', content: bytes });
    });
  });

  it('serves nothing the public role cannot see', async () => {
    await inRolledBackTransaction(async (db) => {
      await sql`SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000000', true)`.execute(
        db,
      );
      const inactive = await tenantId(db, 'test-inactive');
      const bytes = new TextEncoder().encode('logo inactivo de ejemplo');
      const logo = await storeFile(db, store, {
        tenantId: inactive,
        bucket: 'public_assets',
        contentType: 'image/png',
        bytes,
      });
      await select(db, inactive, 'operator_mark', logo.id);
      await asPublic(db);
      expect(await createBrandImageSource(db, store)('test-inactive', logo.sha256)).toBeUndefined();
    });
  });
});
