import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileStore, type FileSpace } from './file-store.js';

const TENANT_A = '0190f8c4-5eed-7000-8000-00000000000a';
const TENANT_B = '0190f8c4-5eed-7000-8000-00000000000b';
const SOURCES_A: FileSpace = { tenantId: TENANT_A, bucket: 'sources' };
const ASSETS_A: FileSpace = { tenantId: TENANT_A, bucket: 'public_assets' };
const ASSETS_B: FileSpace = { tenantId: TENANT_B, bucket: 'public_assets' };

describe('the file store', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'file-store-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bytes = new TextEncoder().encode('logo de ejemplo');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pathIn = (...space: string[]) =>
    join(root, ...space, 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256);

  it('stores bytes under their tenant, bucket and SHA-256, in two levels of folders', async () => {
    const store = createFileStore(root);
    expect(await store.put(ASSETS_A, bytes)).toBe(sha256);
    expect(await store.put('platform', bytes)).toBe(sha256);
    expect(new Uint8Array(await readFile(pathIn(TENANT_A, 'public_assets')))).toEqual(bytes);
    expect(new Uint8Array(await readFile(pathIn('platform')))).toEqual(bytes);
  });

  it('gives bytes back only from their own space', async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    expect(await store.get(SOURCES_A, sha256)).toEqual(bytes);
    // Knowing the hash of another tenant's file, or of a private bucket's, reaches nothing.
    expect(await store.get(ASSETS_B, sha256)).toBeUndefined();
    expect(await store.get(ASSETS_A, sha256)).toBeUndefined();
    expect(await store.get('platform', sha256)).toBeUndefined();
  });

  it('gives nothing for an unknown or malformed hash, and refuses a malformed space', async () => {
    const store = createFileStore(root);
    await store.put(ASSETS_A, bytes);
    expect(await store.get(ASSETS_A, '0'.repeat(64))).toBeUndefined();
    expect(await store.get(ASSETS_A, '../../etc/passwd')).toBeUndefined();
    expect(await store.get(ASSETS_A, sha256.toUpperCase())).toBeUndefined();
    await expect(store.get({ tenantId: '..', bucket: 'sources' }, sha256)).rejects.toThrow(
      TypeError,
    );
    await expect(
      store.put({ tenantId: TENANT_A, bucket: '../platform' as 'sources' }, bytes),
    ).rejects.toThrow(TypeError);
  });

  it('stores the same bytes once, and leaves no temporary files', async () => {
    const store = createFileStore(root);
    await Promise.all([store.put(ASSETS_A, bytes), store.put(ASSETS_A, bytes)]);
    expect(await store.put(ASSETS_A, bytes)).toBe(sha256);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await readdir(join(pathIn(TENANT_A, 'public_assets'), '..'))).toEqual([sha256]);
  });

  it('replaces a stored copy that was cut short or damaged instead of trusting its name', async () => {
    const store = createFileStore(root);
    await store.put(ASSETS_A, bytes);
    await writeFile(pathIn(TENANT_A, 'public_assets'), bytes.slice(0, 4));
    expect(await store.put(ASSETS_A, bytes)).toBe(sha256);
    expect(await store.get(ASSETS_A, sha256)).toEqual(bytes);

    const damaged = bytes.slice();
    damaged[0] = 0;
    await writeFile(pathIn(TENANT_A, 'public_assets'), damaged);
    await store.put(ASSETS_A, bytes);
    expect(await store.get(ASSETS_A, sha256)).toEqual(bytes);
  });

  it('never gives back bytes that are not what their hash says', async () => {
    const store = createFileStore(root);
    await mkdir(join(pathIn(TENANT_A, 'sources'), '..'), { recursive: true });
    await writeFile(pathIn(TENANT_A, 'sources'), new TextEncoder().encode('otra cosa'));
    await expect(store.get(SOURCES_A, sha256)).rejects.toThrow("don't match their hash");
  });

  it("deletes a tenant's bytes and nobody else's", async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    await store.put(ASSETS_A, bytes);
    await store.put(ASSETS_B, bytes);
    await store.put('platform', bytes);
    await store.removeTenant(TENANT_A);
    expect(await store.get(SOURCES_A, sha256)).toBeUndefined();
    expect(await store.get(ASSETS_A, sha256)).toBeUndefined();
    expect(await store.get(ASSETS_B, sha256)).toEqual(bytes);
    expect(await store.get('platform', sha256)).toEqual(bytes);
    await expect(store.removeTenant('..')).rejects.toThrow(TypeError);
    await expect(store.removeTenant('platform')).rejects.toThrow(TypeError);
  });

  it('deletes only temporary files old enough to be leftovers', async () => {
    const store = createFileStore(root);
    expect(await store.removeStaleTemporaryFiles(60_000)).toBe(0);
    await mkdir(join(root, 'tmp'), { recursive: true });
    await writeFile(join(root, 'tmp', 'old'), bytes);
    await writeFile(join(root, 'tmp', 'new'), bytes);
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await utimes(join(root, 'tmp', 'old'), anHourAgo, anHourAgo);
    expect(await store.removeStaleTemporaryFiles(60_000)).toBe(1);
    expect(await readdir(join(root, 'tmp'))).toEqual(['new']);
  });

  it('probes that it can write, and leaves nothing behind', async () => {
    const store = createFileStore(root);
    await store.probe();
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  // Root writes anywhere, so a read-only folder proves nothing when the tests run as root.
  it.skipIf(process.getuid?.() === 0)('fails its probe on a volume it cannot write', async () => {
    const readOnly = join(root, 'read-only');
    await mkdir(join(readOnly, 'tmp'), { recursive: true });
    await chmod(join(readOnly, 'tmp'), 0o555);
    try {
      await expect(createFileStore(readOnly).probe()).rejects.toThrow();
    } finally {
      await chmod(join(readOnly, 'tmp'), 0o755);
    }
  });
});
