import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./put-file.ts', import.meta.url));
const TENANT = '0190f8c4-5eed-7000-8000-00000000000a';

/** Runs the command as an operator would, with bytes on standard input. */
const run = (input: Uint8Array, args: string[], env: Record<string, string>) =>
  new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });

describe('put-file', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'put-file-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const bytes = new TextEncoder().encode('logo de ejemplo');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = (...space: string[]) =>
    readFile(join(root, ...space, 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256));

  it("stores standard input in the tenant's bucket and prints the hash and size", async () => {
    const { code, stdout } = await run(bytes, [TENANT, 'public_assets'], { FILES_ROOT: root });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ sha256, byteSize: bytes.byteLength });
    expect(new Uint8Array(await stored(TENANT, 'public_assets'))).toEqual(bytes);
  });

  it("stores a platform brand asset in the platform's space", async () => {
    const { code } = await run(bytes, ['platform'], { FILES_ROOT: root });
    expect(code).toBe(0);
    expect(new Uint8Array(await stored('platform'))).toEqual(bytes);
  });

  it.each([
    ['no space', []],
    ['a tenant without a bucket', [TENANT]],
    ['an unknown bucket', [TENANT, 'logos']],
    ['a tenant that is not an id', ['../platform', 'sources']],
    ['extra arguments', [TENANT, 'sources', 'more']],
  ])('refuses %s, storing nothing', async (_name, args) => {
    const { code, stderr } = await run(bytes, args, { FILES_ROOT: root });
    expect(code).toBe(1);
    expect(stderr).toContain('usage:');
    const written = await readdir(root, { recursive: true, withFileTypes: true });
    expect(written.filter((entry) => entry.isFile())).toEqual([]);
  });

  it('refuses empty input, and runs only with a store', async () => {
    expect((await run(new Uint8Array(), [TENANT, 'sources'], { FILES_ROOT: root })).code).toBe(1);
    expect((await run(bytes, [TENANT, 'sources'], { FILES_ROOT: '' })).stderr).toContain(
      'FILES_ROOT',
    );
  });
});
