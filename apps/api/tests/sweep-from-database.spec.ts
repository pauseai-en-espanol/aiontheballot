import { createDatabase } from '@aiontheballot/db/client';
import { parseSweepInput, SWEEP_LIST_QUERY } from '@aiontheballot/db/file-sweep';
import { sql } from 'kysely';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import './db.js';

// The script as it is, its own imports resolved as the build would (tests/ts-resolve.mjs).
const TS_RESOLVE = fileURLToPath(new URL('./ts-resolve.mjs', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../src/sweep-files.ts', import.meta.url));

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

/** The test database as `role`, as production gives each login its own. */
const as = (role: string) => {
  const url = new URL(env('TEST_SUPERUSER_DATABASE_URL'));
  url.searchParams.set('options', `-c role=${role}`);
  return url.toString();
};

const run = (args: string[], extra: Record<string, string>) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', TS_RESOLVE, SCRIPT, ...args], {
      env: { PATH: process.env.PATH ?? '', ...extra },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });

describe('sweep-files --from-database (PLAN R141)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sweep-db-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reads the list as the sweep's own login, and checks it against the volume as the piped one", async () => {
    // The test database names the fixtures' files, which this empty volume lacks: the list was read, every row of it,
    // and the sweep refuses to decide anything about a volume that isn't this database's.
    const { code, stderr } = await run(['--from-database', '--delete'], {
      FILES_ROOT: root,
      SWEEPER_DATABASE_URL: as('aiontheballot_sweeper'),
    });
    expect(stderr).toMatch(/named files are not on this volume/);
    expect(code).toBe(1);
  });

  it('sweeps a volume holding every named file, and keeps its ledger there', async () => {
    // The volume as the database names it: a file at each named key (the list checks names, not contents).
    const db = createDatabase({ connectionString: as('aiontheballot_sweeper'), maxConnections: 1 });
    let named: string[];
    try {
      const { rows } = await sql<{ line: string }>`${sql.raw(SWEEP_LIST_QUERY)}`.execute(db);
      named = [...parseSweepInput(rows.map((row) => row.line).join('\n')).named];
    } finally {
      await db.destroy();
    }
    for (const key of named) {
      const parts = key.split('/');
      const sha256 = parts.at(-1) ?? '';
      const path = join(
        root,
        ...parts.slice(0, -1),
        'sha256',
        sha256.slice(0, 2),
        sha256.slice(2, 4),
        sha256,
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, 'x');
    }
    const { code, stdout, stderr } = await run(['--from-database', '--delete'], {
      FILES_ROOT: root,
      SWEEPER_DATABASE_URL: as('aiontheballot_sweeper'),
    });
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(stdout.slice(0, stdout.lastIndexOf('}') + 1))).toMatchObject({
      stored: named.length,
      named: named.length,
      deleted: 0,
    });
    expect(JSON.parse(await readFile(join(root, 'sweep-ledger.json'), 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  it('is refused the list as any other login, and needs its connection set', async () => {
    const refused = await run(['--from-database'], {
      FILES_ROOT: root,
      SWEEPER_DATABASE_URL: as('aiontheballot_admin'),
    });
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/permission denied/);
    const unset = await run(['--from-database'], { FILES_ROOT: root });
    expect(unset.code).toBe(1);
    expect(unset.stderr).toMatch(/SWEEPER_DATABASE_URL is not set/);
  });
});
