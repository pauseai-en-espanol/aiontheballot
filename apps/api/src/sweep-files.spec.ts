import { createFileStore, type FileSpace } from '@aiontheballot/db/file-store';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./sweep-files.ts', import.meta.url));
const TENANT = '0190f8c4-5eed-7000-8000-00000000000a';
const SOURCES: FileSpace = { tenantId: TENANT, bucket: 'sources' };
const ASSETS: FileSpace = { tenantId: TENANT, bucket: 'public_assets' };
const DAY = 24 * 60 * 60 * 1000;

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

const bytesOf = (text: string) => new TextEncoder().encode(text);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const ago = (days: number) => new Date(Date.now() - days * DAY);

/** The owner's list, as the query prints it, taken now. */
const DATABASE = '7-1-5-9';
const list = (lines: string[], auditSequence = 100, incarnation = DATABASE) =>
  [
    ...lines,
    `end ${lines.length} ${new Date().toISOString()} ${auditSequence} ${incarnation} true`,
  ].join('\n');
const NAMED = `${TENANT} sources ${sha('nombrado')}`;
const ORPHAN = `${TENANT}/sources/${sha('huerfano')}`;

describe('sweep-files', () => {
  let root: string;
  let env: Record<string, string>;
  const store = () => createFileStore(root);
  const pathOf = (sha256: string, bucket = 'sources') =>
    join(root, TENANT, bucket, 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  /** Files last written or reused long ago, so the sweep doesn't take them as in use. */
  const age = async (sha256: string, bucket = 'sources') =>
    utimes(pathOf(sha256, bucket), ago(200), ago(200));
  const writeLedger = (entries: Record<string, Date>) =>
    writeFile(
      join(root, 'sweep-ledger.json'),
      JSON.stringify({
        version: 1,
        unnamedSince: Object.fromEntries(
          Object.entries(entries).map(([k, d]) => [k, d.toISOString()]),
        ),
      }),
    );
  const ledger = async () =>
    (
      JSON.parse(await readFile(join(root, 'sweep-ledger.json'), 'utf8')) as {
        unnamedSince: object;
      }
    ).unnamedSince;
  const exists = (sha256: string, space: FileSpace = SOURCES) =>
    store()
      .get(space, sha256)
      .then((bytes) => bytes !== undefined);

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sweep-files-'));
    env = { FILES_ROOT: root };
    await store().put(SOURCES, bytesOf('nombrado'));
    await store().put(SOURCES, bytesOf('huerfano'));
    await age(sha('nombrado'));
    await age(sha('huerfano'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('prints the query the owner pipes in', async () => {
    const { code, stdout } = await run(['--print-query'], '', env);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^COPY \(/);
    expect(stdout).toContain('app.audit_log');
  });

  it('starts the clock for unnamed bytes without --delete, and deletes nothing', async () => {
    const { code, stdout } = await run([], list([NAMED]), env);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      stored: 2,
      named: 1,
      unnamedWaiting: 1,
      deleted: 0,
    });
    expect(Object.keys(await ledger())).toEqual([ORPHAN]);
    expect(await exists(sha('huerfano'))).toBe(true);
  });

  it('deletes bytes no row has named for longer than the grace period, and only with --delete', async () => {
    await writeLedger({ [ORPHAN]: ago(121) });
    const dry = await run([], list([NAMED]), env);
    expect(dry.code).toBe(0);
    expect(await exists(sha('huerfano'))).toBe(true);
    const wet = await run(['--delete'], list([NAMED]), env);
    expect(wet.code).toBe(0);
    expect(JSON.parse(wet.stdout)).toMatchObject({ unnamedExpired: 1, deleted: 1 });
    expect(await exists(sha('huerfano'))).toBe(false);
    expect(await exists(sha('nombrado'))).toBe(true);
    expect(await ledger()).toEqual({});
  });

  it('never deletes named bytes, whatever the ledger says', async () => {
    await writeLedger({ [`${TENANT}/sources/${sha('nombrado')}`]: ago(500) });
    expect((await run(['--delete', '--allow-many'], list([NAMED]), env)).code).toBe(0);
    expect(await exists(sha('nombrado'))).toBe(true);
  });

  it('protects only the space a row names, not the same bytes in another', async () => {
    await store().put(ASSETS, bytesOf('nombrado'));
    await age(sha('nombrado'), 'public_assets');
    await writeLedger({ [`${TENANT}/public_assets/${sha('nombrado')}`]: ago(121) });
    expect((await run(['--delete'], list([NAMED]), env)).code).toBe(0);
    expect(await exists(sha('nombrado'), ASSETS)).toBe(false);
    expect(await exists(sha('nombrado'))).toBe(true);
  });

  it('waits from the last deletion of a row naming the bytes, which the audit log keeps', async () => {
    await writeLedger({ [ORPHAN]: ago(121) });
    const deleted = `deleted ${TENANT} sources ${sha('huerfano')} ${ago(30).toISOString()}`;
    const { code, stdout } = await run(['--delete'], list([NAMED, deleted]), env);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ unnamedExpired: 0, deleted: 0 });
    expect(await exists(sha('huerfano'))).toBe(true);
  });

  it('keeps bytes stored or reused within a day of the snapshot, for a row it may not have seen', async () => {
    await writeLedger({ [ORPHAN]: ago(121) });
    await store().put(SOURCES, bytesOf('huerfano'));
    const { stdout } = await run(['--delete'], list([NAMED]), env);
    expect(JSON.parse(stdout)).toMatchObject({ unnamedExpired: 1, deleted: 0, inUse: 1 });
    expect(await exists(sha('huerfano'))).toBe(true);
  });

  it('deletes more than half the stored files only with --allow-many', async () => {
    await writeLedger({ [ORPHAN]: ago(121), [`${TENANT}/sources/${sha('nombrado')}`]: ago(121) });
    const refused = await run(['--delete'], list([`platform ${sha('otro')}`]), env);
    expect(refused.code).toBe(1);
    await store().put('platform', bytesOf('otro'));
    const many = await run(['--delete'], list([`platform ${sha('otro')}`]), env);
    expect([many.code, many.stderr]).toEqual([1, expect.stringContaining('--allow-many')]);
    expect(await exists(sha('huerfano'))).toBe(true);
    expect(
      (await run(['--delete', '--allow-many'], list([`platform ${sha('otro')}`]), env)).code,
    ).toBe(0);
    expect(await exists(sha('huerfano'))).toBe(false);
  });

  it.each([
    ['a list cut short', `${NAMED}\n`, 'cut short'],
    ['a list that names nothing while files are stored', list([]), 'names no file'],
    [
      'a list naming files the volume lacks',
      list([NAMED, `platform ${sha('ausente')}`]),
      'not on this volume',
    ],
    [
      'a stale list',
      `${NAMED}\nend 1 ${ago(2).toISOString()} 100 7-1-5-9 true`,
      'take a fresh one',
    ],
    [
      'a list from the future',
      `${NAMED}\nend 1 ${new Date(Date.now() + DAY).toISOString()} 100 7-1-5-9 true`,
      'in the future',
    ],
  ])('refuses %s, deleting and recording nothing', async (_name, input, message) => {
    await writeLedger({ [ORPHAN]: ago(121) });
    const before = await readFile(join(root, 'sweep-ledger.json'), 'utf8');
    const { code, stderr } = await run(['--delete', '--allow-many'], input, env);
    expect([code, stderr]).toEqual([1, expect.stringContaining(message)]);
    expect(await exists(sha('huerfano'))).toBe(true);
    expect(await readFile(join(root, 'sweep-ledger.json'), 'utf8')).toBe(before);
  });

  it.each([
    ['its identity changed (a logical restore recreates the tables)', 500, '7-1-5-10'],
    ['its identity changed (a physical restore starts a new timeline)', 600, '7-2-5-9'],
    ['its audit log went back', 100, DATABASE],
  ])(
    'starts every clock again, and deletes nothing even with --delete, after a restore: %s',
    async (_name, auditSequence, incarnation) => {
      await writeFile(
        join(root, 'sweep-ledger.json'),
        JSON.stringify({
          version: 1,
          unnamedSince: { [ORPHAN]: ago(200).toISOString() },
          auditSequence: 500,
          incarnation: DATABASE,
        }),
      );
      const restored = await run(['--delete'], list([NAMED], auditSequence, incarnation), env);
      expect(restored.code).toBe(0);
      expect(JSON.parse(restored.stdout.split('\n}')[0] + '\n}')).toMatchObject({
        restored: true,
        unnamedExpired: 0,
        deleted: 0,
      });
      expect(restored.stdout).toContain('every clock started again');
      expect(await exists(sha('huerfano'))).toBe(true);
      // The reset is kept: the next run measures from now, and knows this database.
      const after = JSON.parse(await readFile(join(root, 'sweep-ledger.json'), 'utf8')) as {
        unnamedSince: Record<string, string>;
        auditSequence: number;
        incarnation: string;
      };
      expect([after.auditSequence, after.incarnation]).toEqual([auditSequence, incarnation]);
      expect(Date.now() - Date.parse(after.unnamedSince[ORPHAN] ?? '')).toBeLessThan(60_000);
      const next = await run(['--delete'], list([NAMED], auditSequence + 1, incarnation), env);
      expect(JSON.parse(next.stdout)).toMatchObject({ restored: false, deleted: 0 });
    },
  );

  it('first puts back what a sweep stopped halfway left aside', async () => {
    const huerfano = join(
      root,
      TENANT,
      'sources',
      'sha256',
      sha('huerfano').slice(0, 2),
      sha('huerfano').slice(2, 4),
      sha('huerfano'),
    );
    const aside = huerfano.replace(root, join(root, 'retired'));
    await mkdir(dirname(aside), { recursive: true });
    await rename(huerfano, aside);
    const { code, stdout } = await run([], list([NAMED]), env);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ recovered: { restored: 1, removed: 0 }, stored: 2 });
    expect(await exists(sha('huerfano'))).toBe(true);
  });

  it('refuses a list taken with row security on', async () => {
    const input = `${NAMED}\nend 1 ${new Date().toISOString()} 100 7-1-5-9 false`;
    const { code, stderr } = await run([], input, env);
    expect([code, stderr]).toEqual([1, expect.stringContaining('row security on')]);
  });

  it('refuses a grace period shorter than the oldest restorable dump', async () => {
    const { code, stderr } = await run(['--delete', '--grace-days', '104'], list([NAMED]), env);
    expect([code, stderr]).toEqual([
      1,
      expect.stringContaining('shorter than the oldest restorable dump'),
    ]);
  });

  it('runs one at a time', async () => {
    const release = await store().lockSweep();
    const { code, stderr } = await run([], list([NAMED]), env);
    expect([code, stderr]).toEqual([1, expect.stringContaining('A sweep or a purge holds')]);
    await release();
    expect((await run([], list([NAMED]), env)).code).toBe(0);
  });

  it('refuses a root that is not there, rather than finding nothing', async () => {
    const { code, stderr } = await run([], list([NAMED]), { FILES_ROOT: join(root, 'falta') });
    expect([code, stderr]).toEqual([1, expect.stringContaining('is the volume mounted?')]);
  });

  it.each([
    [['--force']],
    [['--grace-days']],
    [['--grace-days', 'many']],
    [['--print-query', '--delete']],
  ])('refuses %j', async (args) => {
    const { code, stderr } = await run(args, list([NAMED]), env);
    expect([code, stderr]).toEqual([1, expect.stringContaining('usage:')]);
  });
});
