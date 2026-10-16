import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { readDsn } from '@aiontheballot/observability/dsn';
import { captureException, flush } from '@sentry/node';

import { deleteExpiredAuthRows } from './auth/cleanup.js';
import { initErrorTracking } from './error-tracking.js';

/**
 * The daily clean-up of sign-in data (auth/cleanup.ts), run by the API chart's CronJob from the API's image, never in
 * the API's own process (ADR-0003 §1, guardrail 1). It connects as aiontheballot_auth and prints counts only.
 *
 *   node dist/delete-expired-sessions.js
 */
const url = process.env.AUTH_DATABASE_URL;
if (!url) {
  console.error('AUTH_DATABASE_URL is not set');
  process.exit(1);
}
initErrorTracking(readDsn(process.env));
const pool = createAuthPool({
  connectionString: url,
  maxConnections: 1,
  applicationName: 'aiontheballot-session-cleanup',
});
try {
  const deleted = await deleteExpiredAuthRows(pool);
  console.log(JSON.stringify({ msg: 'Deleted expired sign-in data', ...deleted }));
} catch (error) {
  console.error('Deleting expired sign-in data failed', error);
  captureException(error);
  await flush(2_000);
  process.exitCode = 1;
} finally {
  await pool.end();
}
