import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
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

  it('lists every stored file by space, and reports anything else without touching it', async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    await store.put(ASSETS_B, bytes);
    await store.put('platform', bytes);
    await store.writeLedger('{}');
    await writeFile(join(root, 'stray.txt'), 'x');
    await mkdir(join(root, TENANT_A, 'logos'), { recursive: true });
    await writeFile(join(root, TENANT_A, 'sources', 'stray'), 'x');
    await writeFile(join(pathIn(TENANT_A, 'sources'), '..', 'not-a-hash'), 'x');
    await mkdir(join(root, 'platform', 'sha256', 'abc', 'de'), { recursive: true });
    const { stored, unexpected } = await store.list();
    expect(stored).toEqual(
      expect.arrayContaining([
        { space: SOURCES_A, sha256 },
        { space: ASSETS_B, sha256 },
        { space: 'platform', sha256 },
      ]),
    );
    expect(stored).toHaveLength(3);
    expect(unexpected.sort()).toEqual(
      [
        'stray.txt',
        join(TENANT_A, 'logos'),
        join(TENANT_A, 'sources', 'stray'),
        join(TENANT_A, 'sources', 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), 'not-a-hash'),
        join('platform', 'sha256', 'abc'),
      ].sort(),
    );
  });

  it("never lists one space's bytes as another's through a link", async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    await mkdir(join(root, TENANT_B, 'sources'), { recursive: true });
    await symlink(
      join(root, TENANT_A, 'sources', 'sha256'),
      join(root, TENANT_B, 'sources', 'sha256'),
    );
    await symlink(join(root, TENANT_A, 'sources'), join(root, TENANT_B, 'public_assets'));
    const { stored, unexpected } = await store.list();
    expect(stored).toEqual([{ space: SOURCES_A, sha256 }]);
    expect(unexpected.sort()).toEqual(
      [join(TENANT_B, 'sources', 'sha256'), join(TENANT_B, 'public_assets')].sort(),
    );
  });

  it('lists the root it was given with or without a trailing slash', async () => {
    await createFileStore(root).put(SOURCES_A, bytes);
    await writeFile(join(root, 'stray.txt'), 'x');
    expect((await createFileStore(`${root}/`).list()).unexpected).toEqual(['stray.txt']);
  });

  it('lists nothing on an empty volume', async () => {
    expect(await createFileStore(join(root, 'missing')).list()).toEqual({
      stored: [],
      unexpected: [],
    });
  });

  it('marks bytes as in use whenever it stores or reuses them', async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await utimes(pathIn(TENANT_A, 'sources'), old, old);
    const before = Date.now() - 1000;
    await store.put(SOURCES_A, bytes);
    expect((await stat(pathIn(TENANT_A, 'sources'))).mtimeMs).toBeGreaterThanOrEqual(before);
  });

  it('retires bytes not used since a time, from one space only, and keeps what was used since', async () => {
    const store = createFileStore(root);
    await store.put(SOURCES_A, bytes);
    await store.put(ASSETS_A, bytes);
    const later = new Date(Date.now() + 60_000);
    const earlier = new Date(Date.now() - 60_000);
    expect(await store.retire(SOURCES_A, sha256, earlier)).toBe('kept');
    expect(await store.get(SOURCES_A, sha256)).toEqual(bytes);
    expect(await store.retire(SOURCES_A, sha256, later)).toBe('deleted');
    expect(await store.get(SOURCES_A, sha256)).toBeUndefined();
    expect(await store.retire(SOURCES_A, sha256, later)).toBe('gone');
    expect(await store.get(ASSETS_A, sha256)).toEqual(bytes);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    await expect(store.retire(SOURCES_A, '../x', later)).rejects.toThrow(TypeError);
  });

  it('recovers what a sweep stopped halfway left aside, outside the temporary folder startup clears', async () => {
    const store = createFileStore(root);
    const other = new TextEncoder().encode('otro logo de ejemplo');
    const otherSha = createHash('sha256').update(other).digest('hex');
    await store.put(SOURCES_A, bytes);
    await store.put(ASSETS_B, other);
    const aside = (space: string[], sha: string) =>
      join(root, 'retired', ...space, 'sha256', sha.slice(0, 2), sha.slice(2, 4), sha);
    // One moved aside and never put back; one moved aside whose place got the same bytes again.
    await mkdir(join(aside([TENANT_A, 'sources'], sha256), '..'), { recursive: true });
    await rename(pathIn(TENANT_A, 'sources'), aside([TENANT_A, 'sources'], sha256));
    await mkdir(join(aside([TENANT_B, 'public_assets'], otherSha), '..'), { recursive: true });
    await writeFile(aside([TENANT_B, 'public_assets'], otherSha), other);
    expect(await store.removeStaleTemporaryFiles(0)).toBe(0);
    expect((await store.list()).unexpected).toEqual([]);
    expect(await store.recoverRetired()).toEqual({ restored: 1, removed: 1 });
    expect(await store.get(SOURCES_A, sha256)).toEqual(bytes);
    expect(await store.get(ASSETS_B, otherSha)).toEqual(other);
    expect((await createFileStore(join(root, 'retired')).list()).stored).toEqual([]);
  });

  it('keeps one sweep at a time', async () => {
    const store = createFileStore(root);
    const release = await store.lockSweep();
    await expect(store.lockSweep()).rejects.toThrow('Another sweep');
    await release();
    const again = await store.lockSweep();
    await again();
  });

  it('keeps the sweep ledger on the volume', async () => {
    const store = createFileStore(root);
    expect(await store.readLedger()).toBeUndefined();
    await store.writeLedger('{"version":1}');
    expect(await store.readLedger()).toBe('{"version":1}');
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });
});
