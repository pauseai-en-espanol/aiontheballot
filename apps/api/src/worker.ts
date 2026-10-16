import { createDatabase } from '@aiontheballot/db/client';
import { readDsn } from '@aiontheballot/observability/dsn';
import { captureException, captureMessage, flush } from '@sentry/node';
import { fileURLToPath } from 'node:url';

import { initErrorTracking } from './error-tracking.js';
import { createChildExtractor } from './worker/child-extractor.js';
import { readRootsFor } from './worker/child.js';
import { SELF_CHECKS } from './worker/self-check.js';
import { buildWorkerApp, MAX_COPY_BYTES } from './worker/server.js';
import { readWorkerToken } from './worker/token.js';

/**
 * The worker (PLAN R116, R133): extracts sources' text, one copy at a time, each parsed in a child process of its own
 * with a memory limit, a deadline and no access to the disk, the network or this process's environment. It needs only
 * its database login (WORKER_DATABASE_URL, as aiontheballot_worker) and the secret it shares with the API
 * (WORKER_TOKEN, ADR-0006), and listens on PORT for the API alone. Its own faults go to error tracking (SENTRY_DSN),
 * never what a document holds. Run as `node dist/worker.js`.
 */
initErrorTracking(readDsn(process.env), { initialScope: { tags: { component: 'worker' } } });
const databaseUrl = process.env.WORKER_DATABASE_URL;
if (!databaseUrl) {
  console.error('WORKER_DATABASE_URL is not set');
  process.exit(1);
}
let token: string;
try {
  token = readWorkerToken(process.env.WORKER_TOKEN);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3002);

const extractor = createChildExtractor(new URL('./worker/extract-child.js', import.meta.url), {
  timeoutMs: Number(process.env.EXTRACTION_TIMEOUT_MS ?? 120_000),
  memoryMb: Number(process.env.EXTRACTION_MEMORY_MB ?? 512),
  // A copy's text, as JSON: about what a 50 MB copy's text can be. The worker parses the answer with about five times
  // its size of memory, which the pod's limit leaves room for beside the child's (chart values).
  maxOutputBytes: MAX_COPY_BYTES,
  readRoots: readRootsFor(fileURLToPath(new URL('.', import.meta.url))),
});

// Every parser must start and work in its box, or every job of its kind would fail as the document's fault: a broken
// build or a wrong setting stops here, in the logs, before taking any job.
for (const { contentType, bytes, word } of SELF_CHECKS) {
  const check = await extractor(contentType, bytes).catch(() => undefined);
  if (check?.status !== 'done' || !check.units.some((unit) => unit.body.includes(word))) {
    const message = `The parser for ${contentType} does not run: the worker takes no jobs`;
    console.error(message);
    captureMessage(message, 'fatal');
    await flush(2_000);
    process.exit(1);
  }
}

const db = createDatabase({
  connectionString: databaseUrl,
  maxConnections: 4,
  applicationName: 'aiontheballot-worker',
});
const app = buildWorkerApp({
  db,
  extractor,
  token,
  onFault: (error) => captureException(error),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
app.log.info(
  { checked: SELF_CHECKS.map(({ contentType }) => contentType) },
  'Self-check passed: every parser runs in its box',
);

const shutdown = async () => {
  await app.close();
  await db.destroy();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

await app.listen({ host: '0.0.0.0', port });
