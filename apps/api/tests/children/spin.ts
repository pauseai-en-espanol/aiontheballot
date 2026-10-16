import { startMemoryWatchdog } from '../../src/worker/watchdog.js';

startMemoryWatchdog(Number(process.argv[2]));
for (;;) {
  // An endless loop: only the deadline ends it.
}
