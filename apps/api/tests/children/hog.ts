import { answer, startMemoryWatchdog } from '../../src/worker/watchdog.js';

// Outside V8's heap, as a decompression bomb fills it: 32 MB buffers, touched so they are resident, up to 2 GB.
startMemoryWatchdog(Number(process.argv[2]));
const hog: Uint8Array[] = [];
for (let i = 0; i < 64; i += 1) {
  hog.push(new Uint8Array(32 * 1024 * 1024).fill(1));
}
answer({ survived: hog.length });
