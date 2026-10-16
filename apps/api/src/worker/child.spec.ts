import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type ChildLimits, readRootsFor, runInChild } from './child.js';

const child = (name: string) => new URL(`../../tests/children/${name}.ts`, import.meta.url);
const limits: ChildLimits = {
  timeoutMs: 20_000,
  memoryMb: 256,
  maxOutputBytes: 1024 * 1024,
  readRoots: readRootsFor(fileURLToPath(new URL('.', import.meta.url))),
  // The sources as they are, as the build would run them.
  execArgv: ['--import', fileURLToPath(new URL('../../tests/ts-resolve.mjs', import.meta.url))],
};

describe('runInChild (PLAN R133)', () => {
  it('gives the child its input and arguments, and nothing else: no environment, no other files, no network', async () => {
    const outside = fileURLToPath(new URL('../../../../package.json', import.meta.url));
    const outcome = await runInChild(
      child('probe'),
      ['text/plain', outside],
      new Uint8Array(1000),
      limits,
    );
    expect(outcome).toEqual({
      kind: 'answer',
      answer: {
        bytes: 1000,
        args: ['text/plain', outside],
        env: expect.any(Array),
        read: 'ERR_ACCESS_DENIED',
        write: 'ERR_ACCESS_DENIED',
        network: 'ERR_ACCESS_DENIED',
      },
    });
    // Nothing of the parent's environment; macOS adds one variable of its own to every process it starts.
    const { env } = (outcome as { answer: { env: string[] } }).answer;
    expect(env.filter((name) => name !== '__CF_USER_TEXT_ENCODING')).toEqual([]);
    expect(existsSync('/tmp/aiontheballot-child-probe')).toBe(false);
  });

  it('stops a child that fills memory outside its heap, as a decompression bomb does', async () => {
    const started = Date.now();
    expect(await runInChild(child('hog'), [], new Uint8Array(), limits)).toEqual({
      kind: 'fault',
      fault: 'memory',
    });
    // The watchdog, not the deadline.
    expect(Date.now() - started).toBeLessThan(limits.timeoutMs);
  });

  it('stops an endless loop at its deadline', async () => {
    expect(
      await runInChild(child('spin'), [], new Uint8Array(), { ...limits, timeoutMs: 500 }),
    ).toEqual({ kind: 'fault', fault: 'time' });
  });

  it('refuses an answer longer than it takes, and any other way of stopping', async () => {
    expect(await runInChild(child('chatty'), [], new Uint8Array(), limits)).toEqual({
      kind: 'fault',
      fault: 'output',
    });
    expect(await runInChild(child('crash'), [], new Uint8Array(), limits)).toEqual({
      kind: 'fault',
      fault: 'crash',
    });
  });

  it("ends as a crash when the child can't load its script, which the worker's startup check catches", async () => {
    await expect(
      runInChild(child('probe'), [], new Uint8Array(), { ...limits, readRoots: ['/nonexistent'] }),
    ).resolves.toEqual({ kind: 'fault', fault: 'crash' });
  });
});
