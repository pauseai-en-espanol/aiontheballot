import { readDsn } from '@aiontheballot/observability/dsn';
import { captureException } from '@sentry/node';

import { initErrorTracking } from './error-tracking.js';
import { archiveSnapshot, readArchiveUrl } from './fetcher/archive.js';
import { FETCHER_TRACKING } from './fetcher/error-tracking.js';
import { fetchUrl } from './fetcher/fetch-url.js';
import { buildFetcherApp } from './fetcher/server.js';
import { readSharedToken } from './worker/token.js';

/**
 * The fetcher (ADR-0007): fetches a URL's bytes for a source's copy, and asks the Internet Archive for a snapshot,
 * for the API alone, which stores what it gives. It has no database login, no volume and no credential but the
 * secret it shares with the API (FETCHER_TOKEN) and, optionally, the archive's keys (ARCHIVE_ACCESS_KEY,
 * ARCHIVE_SECRET_KEY); its NetworkPolicy lets it reach only DNS and the public internet. It parses nothing it fetches.
 * Its own faults go to error tracking (SENTRY_DSN), by their class only. Run as `node dist/fetcher.js`.
 */
initErrorTracking(readDsn(process.env), FETCHER_TRACKING);
let token: string;
let archiveUrl: string;
try {
  token = readSharedToken('FETCHER_TOKEN', process.env.FETCHER_TOKEN);
  archiveUrl = readArchiveUrl(process.env.ARCHIVE_URL);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
const access = process.env.ARCHIVE_ACCESS_KEY || undefined;
const secret = process.env.ARCHIVE_SECRET_KEY || undefined;
if (Boolean(access) !== Boolean(secret)) {
  console.error(
    'The archive keys are half configured: set both ARCHIVE_ACCESS_KEY and ARCHIVE_SECRET_KEY, or neither',
  );
  process.exit(1);
}
const keys = access && secret ? { access, secret } : undefined;
const port = Number(process.env.PORT ?? 3003);
// The whole fetch: within the admin route's 15 seconds (Envoy's default), with room for storing the copy after.
const deadlineMs = Number(process.env.FETCH_TIMEOUT_MS || 8_000);
if (!Number.isInteger(deadlineMs) || deadlineMs < 1_000 || deadlineMs > 10_000) {
  console.error('FETCH_TIMEOUT_MS must be a whole number of milliseconds from 1000 to 10000');
  process.exit(1);
}
// How the fetcher names itself to sites: configuration, so no product name is written here.
const userAgent = process.env.FETCHER_USER_AGENT || 'Mozilla/5.0 (compatible; source-fetcher)';

const app = buildFetcherApp({
  token,
  // A copy's limit, as the files table's check has it.
  fetchUrl: (url) => fetchUrl(url, { maxBytes: 50 * 1024 * 1024, deadlineMs, userAgent }),
  // Each fetch holds its copy until it is sent: two at once stay within the pod's memory (chart values).
  maxFetches: 2,
  archive: (url) => archiveSnapshot(url, { archiveUrl, keys }),
  onFault: (error) => captureException(error),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});
await app.listen({ host: '0.0.0.0', port });
app.log.info({ archive: archiveUrl, keys: keys !== undefined }, 'The fetcher is listening');

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
