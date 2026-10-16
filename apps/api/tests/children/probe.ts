import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';

import { answer, readInput, startMemoryWatchdog } from '../../src/worker/watchdog.js';

// What a child may do: it answers with its input's size, its environment, and whether it could write or connect.
startMemoryWatchdog(Number(process.argv[2]));
const input = await readInput();
let write = 'allowed';
try {
  writeFileSync('/tmp/aiontheballot-child-probe', 'x');
} catch (error) {
  write = (error as NodeJS.ErrnoException).code ?? 'refused';
}
// A file outside what it may read: the workspace's own root, where `.env` lives in development.
let read = 'allowed';
try {
  readFileSync(process.argv[4] ?? '');
} catch (error) {
  read = (error as NodeJS.ErrnoException).code ?? 'refused';
}
const network = await new Promise<string>((resolve) => {
  try {
    const socket = connect(9, '127.0.0.1');
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'refused'));
    socket.once('connect', () => {
      socket.destroy();
      resolve('allowed');
    });
  } catch (error) {
    resolve((error as NodeJS.ErrnoException).code ?? 'refused');
  }
});
answer({
  bytes: input.byteLength,
  args: process.argv.slice(3),
  env: Object.keys(process.env),
  read,
  write,
  network,
});
