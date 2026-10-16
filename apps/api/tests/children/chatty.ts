import { answer } from '../../src/worker/watchdog.js';

// An answer far longer than the parent takes.
answer({ text: 'x'.repeat(4 * 1024 * 1024) });
