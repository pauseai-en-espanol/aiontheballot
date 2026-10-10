import { createFileStore } from '@aiontheballot/db/file-store';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./purge-tenant-files.ts', import.meta.url));
const PURGED = '0190f8c4-5eed-7000-8000-00000000000a';
const OTHER = '0190f8c4-5eed-7000-8000-00000000000b';

/** Runs the command as an operator would, with the owner's query's output on standard input. */
const run = (args: string[], input: string, env: Record<string, string>) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });

describe('purge-tenant-files', () => {
  let root: string;
  let env: Record<string, string>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'purge-tenant-files-'));
    env = { FILES_ROOT: root };
    const store = createFileStore(root);
    const bytes = new TextEncoder().encode('archivo de ejemplo');
    await store.put({ tenantId: PURGED, bucket: 'sources' }, bytes);
    await store.put({ tenantId: PURGED, bucket: 'public_assets' }, bytes);
    await store.put({ tenantId: OTHER, bucket: 'sources' }, bytes);
    await store.put('platform', bytes);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const folders = async () => (await readdir(root)).sort();

  it('says what it would delete, and deletes nothing without --delete', async () => {
    const { code, stdout } = await run([PURGED], `purged ${PURGED}\n`, env);
    expect(code).toBe(0);
    expect(stdout).toContain('Would delete 2 files');
    expect(await folders()).toEqual([OTHER, PURGED, 'platform', 'tmp'].sort());
  });

  it("deletes a purged tenant's folder, and nobody else's", async () => {
    const { code, stdout } = await run([PURGED, '--delete'], `purged ${PURGED}\n`, env);
    expect(code).toBe(0);
    expect(stdout).toContain('Deleted 2 files');
    expect(await folders()).toEqual([OTHER, 'platform', 'tmp'].sort());
  });

  it("reads the proof from psql's aligned output too", async () => {
    const aligned = ` ?column? \n---------\n purged ${PURGED}\n(1 row)\n`;
    expect((await run([PURGED, '--delete'], aligned, env)).code).toBe(0);
  });

  it.each([
    // The owner's query prints nothing for a tenant that still exists, active or not, or was never purged.
    ['without proof (a tenant that still exists, or a mistyped id)', ''],
    ['with proof for another tenant', `purged ${OTHER}\n`],
    ['with a proof line that only contains the id', `not purged ${PURGED} yet\n`],
  ])('refuses %s', async (_name, proof) => {
    const { code, stderr } = await run([PURGED, '--delete'], proof, env);
    expect(code).toBe(1);
    expect(stderr).toContain('No proof');
    expect(await folders()).toContain(PURGED);
  });

  it.each([
    ['no tenant', []],
    ['a tenant that is not an id', ['platform', '--delete']],
    ['an unknown flag', [PURGED, '--force']],
  ])('refuses %s', async (_name, args) => {
    const { code, stderr } = await run(args, `purged ${PURGED}\n`, env);
    expect(code).toBe(1);
    expect(stderr).toContain('usage:');
    expect((await folders()).length).toBe(4);
  });
});
