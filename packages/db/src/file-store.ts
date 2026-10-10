import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const FILE_BUCKETS = ['public_assets', 'sources'] as const;
export const isTenantId = (value: string): boolean => UUID.test(value);
export type FileBucket = (typeof FILE_BUCKETS)[number];

/**
 * Whose bytes these are (ADR-0004): one bucket of one tenant, as an `app.files` row names them, or the platform's
 * brand assets. Bytes are found only within their space, so a row can never name another tenant's or another
 * bucket's bytes by their hash.
 */
export type FileSpace = { tenantId: string; bucket: FileBucket } | 'platform';

/**
 * The bytes of stored files, on a persistent volume (ADR-0001, files; ADR-0004): under their space and their SHA-256,
 * so the same bytes are stored once per space and never change. The database keeps the rows that say who owns a file,
 * who may see it and what its hash is; this store only keeps bytes, and callers read them only for a row RLS showed
 * them, from that row's space.
 */
export interface FileStore {
  /** Stores the bytes, unless the same bytes are stored already, and returns their SHA-256. */
  put: (space: FileSpace, bytes: Uint8Array) => Promise<string>;
  /** The bytes with this SHA-256 in this space, or undefined if none are stored. Throws if they don't match it. */
  get: (space: FileSpace, sha256: string) => Promise<Uint8Array | undefined>;
  /** Deletes every byte of a tenant, after `purge_tenant` (ADR-0004). */
  removeTenant: (tenantId: string) => Promise<void>;
  /** Deletes temporary files older than `maxAgeMs` (a crash mid-write leaves one) and returns how many it deleted. */
  removeStaleTemporaryFiles: (maxAgeMs: number) => Promise<number>;
  /** Writes, syncs and deletes a probe file, so a server can say at startup whether it can store anything. */
  probe: () => Promise<void>;
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const spaceDirectory = (root: string, space: FileSpace): string => {
  if (space === 'platform') {
    return join(root, 'platform');
  }
  if (!isTenantId(space.tenantId) || !FILE_BUCKETS.includes(space.bucket)) {
    throw new TypeError(`Not a file space: ${JSON.stringify(space)}`);
  }
  return join(root, space.tenantId, space.bucket);
};

/** Bytes live at `{root}/{space}/sha256/ab/cd/abcd…`: two levels of 256 folders, so no folder grows too large. */
const pathOf = (root: string, space: FileSpace, sha256: string): string =>
  join(spaceDirectory(root, space), 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256);

const readIfPresent = async (path: string): Promise<Uint8Array | undefined> => {
  try {
    return new Uint8Array(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

/** Writes the whole file and flushes it to the disk before returning. */
const writeSynced = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

/** Flushes a folder, so a rename into it survives a crash. */
const syncDirectory = async (path: string): Promise<void> => {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const createFileStore = (root: string): FileStore => {
  const temporaryDirectory = join(root, 'tmp');

  /** Written aside, synced, then renamed into place: a reader never sees half a file. */
  const writeAtomically = async (target: string, bytes: Uint8Array): Promise<void> => {
    const temporary = join(temporaryDirectory, randomUUID());
    await mkdir(temporaryDirectory, { recursive: true });
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeSynced(temporary, bytes);
      // The temporary folder is on the same volume, so the rename is atomic.
      await rename(temporary, target);
      await syncDirectory(dirname(target));
    } finally {
      await rm(temporary, { force: true });
    }
  };

  return {
    put: async (space, bytes) => {
      const sha256 = sha256Of(bytes);
      const target = pathOf(root, space, sha256);
      // Already there: kept only if it is whole and right. A file cut short by a crash, or damaged since, is
      // replaced by a good copy rather than trusted for its name.
      const existing = await readIfPresent(target);
      if (existing && existing.byteLength === bytes.byteLength && sha256Of(existing) === sha256) {
        return sha256;
      }
      await writeAtomically(target, bytes);
      return sha256;
    },
    get: async (space, sha256) => {
      if (!SHA256.test(sha256)) {
        return undefined;
      }
      const bytes = await readIfPresent(pathOf(root, space, sha256));
      if (bytes && sha256Of(bytes) !== sha256) {
        // Never served: whatever it is, it isn't the file its row names.
        throw new Error(`The stored bytes of ${sha256} don't match their hash`);
      }
      return bytes;
    },
    removeTenant: async (tenantId) => {
      if (!isTenantId(tenantId)) {
        throw new TypeError(`Not a tenant id: ${tenantId}`);
      }
      await rm(join(root, tenantId), { recursive: true, force: true });
    },
    removeStaleTemporaryFiles: async (maxAgeMs) => {
      let names: string[];
      try {
        names = await readdir(temporaryDirectory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return 0;
        }
        throw error;
      }
      let removed = 0;
      for (const name of names) {
        const path = join(temporaryDirectory, name);
        // Another server may be writing one right now: only old ones are leftovers.
        const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: Date.now() }));
        if (Date.now() - mtimeMs > maxAgeMs) {
          await rm(path, { force: true });
          removed += 1;
        }
      }
      return removed;
    },
    probe: async () => {
      await mkdir(temporaryDirectory, { recursive: true });
      const path = join(temporaryDirectory, `probe-${randomUUID()}`);
      try {
        await writeSynced(path, new TextEncoder().encode('probe'));
      } finally {
        await rm(path, { force: true });
      }
    },
  };
};
