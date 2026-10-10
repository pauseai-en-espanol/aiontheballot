import type { Dirent } from 'node:fs';

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

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
  /**
   * Stores the bytes, unless the same bytes are stored already, and returns their SHA-256. Either way the file's
   * modification time becomes now, which the sweep reads as "in use" (ADR-0004 §5).
   */
  put: (space: FileSpace, bytes: Uint8Array) => Promise<string>;
  /** The bytes with this SHA-256 in this space, or undefined if none are stored. Throws if they don't match it. */
  get: (space: FileSpace, sha256: string) => Promise<Uint8Array | undefined>;
  /** Deletes every byte of a tenant, after `purge_tenant` (ADR-0004). */
  removeTenant: (tenantId: string) => Promise<void>;
  /** Deletes temporary files older than `maxAgeMs` (a crash mid-write leaves one) and returns how many it deleted. */
  removeStaleTemporaryFiles: (maxAgeMs: number) => Promise<number>;
  /** Writes, syncs and deletes a probe file, so a server can say at startup whether it can store anything. */
  probe: () => Promise<void>;
  /** Every stored file, and the paths of anything else found among them (never deleted by the sweep). */
  list: () => Promise<{ stored: StoredFile[]; unexpected: string[] }>;
  /**
   * Deletes one file's bytes for the sweep (ADR-0004 §5), unless they were stored or reused at or after `inUseSince`.
   * The file is moved aside first (to `retired/`, under the same space and hash) and checked there, so a `put` that
   * reuses it at the same moment either finds it gone and writes it again, or touches it and gets it put back.
   */
  retire: (
    space: FileSpace,
    sha256: string,
    inUseSince: Date,
  ) => Promise<'deleted' | 'kept' | 'gone'>;
  /**
   * Puts back whatever a sweep stopped halfway left in `retired/` (its place is empty), or deletes it (its place has
   * the same bytes again): run before each sweep.
   */
  recoverRetired: () => Promise<{ restored: number; removed: number }>;
  /** The sweep's ledger, kept on the volume beside the bytes it describes. */
  readLedger: () => Promise<string | undefined>;
  writeLedger: (text: string) => Promise<void>;
  /** Takes the sweep's lock, so two sweeps never run at once; resolves to its release, or throws if it is taken. */
  lockSweep: () => Promise<() => Promise<void>>;
}

export interface StoredFile {
  space: FileSpace;
  sha256: string;
}

const TMP = 'tmp';
const LEDGER = 'sweep-ledger.json';
const LOCK = 'sweep.lock';
/** Where the sweep moves a file before it decides, laid out like the root: never in `tmp/`, which startup clears. */
const RETIRED = 'retired';
const PREFIX = /^[0-9a-f]{2}$/;

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

/** A folder's entries, or none if it doesn't exist. */
const entriesIn = async (path: string): Promise<Dirent[]> => {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

/** Whether a path is a real folder, not a link to one: a link could make one space's bytes look like another's. */
const isRealFolder = async (path: string): Promise<boolean> => {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

/**
 * The files under a space's `sha256/ab/cd/` folders. Anything that doesn't fit that layout, links included, goes to
 * `unexpected`, as paths relative to the root.
 */
const listSpace = async (
  root: string,
  space: FileSpace,
  stored: StoredFile[],
  unexpected: string[],
): Promise<void> => {
  const folder = spaceDirectory(root, space);
  const base = join(folder, 'sha256');
  const at = (...parts: string[]) => relative(root, join(folder, ...parts));
  for (const entry of await entriesIn(folder)) {
    if (entry.name !== 'sha256' || !(await isRealFolder(base))) {
      unexpected.push(at(entry.name));
    }
  }
  if (!(await isRealFolder(base))) {
    return;
  }
  for (const first of await entriesIn(base)) {
    if (!first.isDirectory() || !PREFIX.test(first.name)) {
      unexpected.push(at('sha256', first.name));
      continue;
    }
    for (const second of await entriesIn(join(base, first.name))) {
      if (!second.isDirectory() || !PREFIX.test(second.name)) {
        unexpected.push(at('sha256', first.name, second.name));
        continue;
      }
      for (const file of await entriesIn(join(base, first.name, second.name))) {
        if (
          file.isFile() &&
          SHA256.test(file.name) &&
          file.name.startsWith(first.name + second.name)
        ) {
          stored.push({ space, sha256: file.name });
        } else {
          unexpected.push(at('sha256', first.name, second.name, file.name));
        }
      }
    }
  }
};

/** Whether a path exists, without following a link or reading it. */
const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

/** Moves a file set aside back to its place, unless the same bytes were written there again meanwhile. */
const putBack = async (target: string, aside: string): Promise<'restored' | 'removed'> => {
  if (await exists(target)) {
    await rm(aside, { force: true });
    return 'removed';
  }
  await mkdir(dirname(target), { recursive: true });
  await rename(aside, target);
  return 'restored';
};

export const createFileStore = (root: string): FileStore => {
  const temporaryDirectory = join(root, TMP);

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
        try {
          // In use again: the sweep leaves it alone. Gone since it was read (the sweep moved it): write it again.
          const now = new Date();
          await utimes(target, now, now);
          return sha256;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
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
    list: async () => {
      const stored: StoredFile[] = [];
      const unexpected: string[] = [];
      for (const entry of await entriesIn(root)) {
        if (
          ([TMP, RETIRED].includes(entry.name) && entry.isDirectory()) ||
          ([LEDGER, LOCK].includes(entry.name) && entry.isFile())
        ) {
          continue;
        }
        if (entry.name === 'platform' && entry.isDirectory()) {
          await listSpace(root, 'platform', stored, unexpected);
        } else if (isTenantId(entry.name) && entry.isDirectory()) {
          for (const bucket of await entriesIn(join(root, entry.name))) {
            const known = FILE_BUCKETS.find((name) => name === bucket.name);
            if (known && bucket.isDirectory()) {
              await listSpace(root, { tenantId: entry.name, bucket: known }, stored, unexpected);
            } else {
              unexpected.push(relative(root, join(root, entry.name, bucket.name)));
            }
          }
        } else {
          unexpected.push(entry.name);
        }
      }
      return { stored, unexpected };
    },
    retire: async (space, sha256, inUseSince) => {
      if (!SHA256.test(sha256)) {
        throw new TypeError(`Not a SHA-256: ${sha256}`);
      }
      const target = pathOf(root, space, sha256);
      const aside = pathOf(join(root, RETIRED), space, sha256);
      await mkdir(dirname(aside), { recursive: true });
      try {
        await rename(target, aside);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return 'gone';
        }
        throw error;
      }
      // Stored or reused since `inUseSince`, the move included (a put that read it just before touched it): it goes
      // back. A put that comes after the move finds it gone and writes it again.
      if ((await lstat(aside)).mtime >= inUseSince) {
        await putBack(target, aside);
        return 'kept';
      }
      await rm(aside, { force: true });
      return 'deleted';
    },
    recoverRetired: async () => {
      const { stored } = await createFileStore(join(root, RETIRED)).list();
      let restored = 0;
      for (const { space, sha256 } of stored) {
        const outcome = await putBack(
          pathOf(root, space, sha256),
          pathOf(join(root, RETIRED), space, sha256),
        );
        restored += outcome === 'restored' ? 1 : 0;
      }
      return { restored, removed: stored.length - restored };
    },
    readLedger: async () => {
      try {
        return await readFile(join(root, LEDGER), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return undefined;
        }
        throw error;
      }
    },
    writeLedger: async (text) => {
      await writeAtomically(join(root, LEDGER), new TextEncoder().encode(text));
    },
    lockSweep: async () => {
      const path = join(root, LOCK);
      try {
        await writeSynced(
          path,
          new TextEncoder().encode(`${process.pid} ${new Date().toISOString()}\n`),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            `Another sweep holds ${path}. If none is running (one stopped halfway), delete that file and run again.`,
            { cause: error },
          );
        }
        throw error;
      }
      return () => rm(path, { force: true });
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
