import { Worker } from 'node:worker_threads';

/**
 * Inside a child that `runInChild` started: a thread that kills the whole process once its resident set passes
 * `memoryMb`, checked every 10 ms. A thread of its own, so a parser stuck in a long synchronous loop (inflating a
 * stream, say) can't keep it from checking, and the resident set, so memory outside V8's heap (ArrayBuffers) counts. A
 * fast allocation can pass the limit by what it adds in 10 ms before it is stopped; the pod's own memory limit, which
 * leaves room for it, is the last word.
 */
export const startMemoryWatchdog = (memoryMb: number): void => {
  if (!Number.isFinite(memoryMb) || memoryMb <= 0) {
    throw new TypeError(`Not a memory limit: ${memoryMb}`);
  }
  const watchdog = new Worker(
    `const { workerData } = require('node:worker_threads');
     setInterval(() => {
       if (process.memoryUsage.rss() > workerData) {
         process.kill(process.pid, 'SIGKILL');
       }
     }, 10);`,
    { eval: true, workerData: memoryMb * 1024 * 1024 },
  );
  // It never keeps the child alive once its work is done.
  watchdog.unref();
};

/** All of the child's stdin. */
export const readInput = async (): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
};

/** The child's one answer, as JSON on stdout; the process ends once it is written. */
export const answer = (value: unknown): void => {
  process.stdout.write(JSON.stringify(value));
};
