import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * How a parse ended that never gave a result: it ran past its deadline, it used more memory than it was given (the
 * watchdog's kill or V8's heap limit), its answer was larger than allowed, or it stopped some other way. Each is the
 * document's fault, so its job is recorded as failed.
 */
export type ChildFault = 'time' | 'memory' | 'output' | 'crash';

export type ChildOutcome =
  { kind: 'answer'; answer: unknown } | { kind: 'fault'; fault: ChildFault };

export interface ChildLimits {
  timeoutMs: number;
  /** The most memory the child may hold, all of it (its resident set, ArrayBuffers included), in MB. */
  memoryMb: number;
  /** The largest answer taken from the child, in bytes. */
  maxOutputBytes: number;
  /** The folders the child may read (its code and its dependencies), and nothing else on the disk: `readRoots`. */
  readRoots: readonly string[];
  /** Extra Node flags before the script: the tests' TypeScript loader, say. */
  execArgv?: readonly string[];
}

/**
 * What a child needs to read to load its code and its dependencies, and no more: the nearest folder above `from` that
 * has a node_modules (the app: `/app` in the image, `apps/api` in development), and the node_modules holding pnpm's
 * packages, if it is elsewhere (the workspace's, in development). Never the workspace's root, which holds `.env`.
 */
export const readRootsFor = (from: string): string[] => {
  const up = function* (start: string) {
    for (let folder = start; ; folder = dirname(folder)) {
      yield folder;
      if (dirname(folder) === folder) {
        return;
      }
    }
  };
  let app: string | undefined;
  for (const folder of up(from)) {
    if (existsSync(join(folder, 'node_modules'))) {
      app = folder;
      break;
    }
  }
  if (!app) {
    return [from];
  }
  for (const folder of up(app)) {
    const store = join(folder, 'node_modules');
    if (existsSync(join(store, '.pnpm'))) {
      const inside = !relative(app, store).startsWith('..');
      return inside ? [app] : [app, store];
    }
  }
  return [app];
};

/**
 * Runs `script` in a child process of its own (PLAN R133), as `script <memoryMb> ...args`, gives it `input` on stdin
 * and takes one JSON answer from its stdout. The child runs under Node's permission model, so it can read only
 * `readRoots`, and can't write a file, open a connection or start a process; with an empty environment, so nothing of
 * the worker's (its database login) reaches it; and with its heap capped at `memoryMb`. The script itself starts a watchdog thread that kills it once its
 * resident set passes `memoryMb` (`startMemoryWatchdog`), which the heap cap alone wouldn't see: a decompression bomb
 * fills ArrayBuffers, outside the heap. Past `timeoutMs` the parent kills it.
 *
 * Resolves with the answer, or with the fault that stopped the child; rejects only when the child couldn't be started
 * at all, which is the worker's fault, not the document's.
 */
export const runInChild = (
  script: URL,
  args: readonly string[],
  input: Uint8Array,
  { timeoutMs, memoryMb, maxOutputBytes, readRoots, execArgv = [] }: ChildLimits,
): Promise<ChildOutcome> =>
  new Promise<ChildOutcome>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--permission',
        ...readRoots.map((root) => `--allow-fs-read=${root}`),
        // The watchdog is a thread: it inherits every restriction above.
        '--allow-worker',
        `--max-old-space-size=${memoryMb}`,
        '--disallow-code-generation-from-strings',
        '--no-warnings',
        ...execArgv,
        fileURLToPath(script),
        String(memoryMb),
        ...args,
      ],
      // stderr is the document's text as often as not (a parser's warnings): never kept, never logged.
      { env: {}, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let timedOut = false;
    let output: Buffer[] = [];
    let outputBytes = 0;
    let tooLong = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        if (!tooLong) {
          tooLong = true;
          output = [];
          child.kill('SIGKILL');
        }
        return;
      }
      output.push(chunk);
    });
    // A child that dies before reading all of its input closes the pipe under the write: its exit says why.
    child.stdin.on('error', () => undefined);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ kind: 'fault', fault: 'time' });
        return;
      }
      if (tooLong) {
        resolve({ kind: 'fault', fault: 'output' });
        return;
      }
      if (code === 0) {
        try {
          resolve({ kind: 'answer', answer: JSON.parse(Buffer.concat(output).toString('utf8')) });
        } catch {
          resolve({ kind: 'fault', fault: 'crash' });
        }
        return;
      }
      // Killed by its watchdog (SIGKILL), or aborted by V8 at its heap limit (SIGABRT, or 134 when a shell reports it):
      // out of memory. Anything else is a crash.
      const outOfMemory = signal === 'SIGKILL' || signal === 'SIGABRT' || code === 134;
      resolve({ kind: 'fault', fault: outOfMemory ? 'memory' : 'crash' });
    });
    child.stdin.end(input);
  });
