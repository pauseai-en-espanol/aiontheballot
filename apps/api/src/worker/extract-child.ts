import { extract } from './extract.js';
import { answer, readInput, startMemoryWatchdog } from './watchdog.js';

/**
 * The parser's own process (child.ts): `node extract-child.js <memoryMb> <content type>`, the copy's bytes on stdin. It
 * answers with the extracted units, or that the parser failed on them; anything worse (memory, time) ends the process,
 * which the worker records as a failed extraction.
 */
const [memoryMb = '', contentType = ''] = process.argv.slice(2);
startMemoryWatchdog(Number(memoryMb));
const bytes = await readInput();
try {
  answer({ ok: true, result: await extract(contentType, bytes) });
} catch {
  // What the parser choked on is the party's document: nothing of it goes back, only that it failed.
  answer({ ok: false });
}
