import { createDatabase } from '@aiontheballot/db/client';
import { readDsn } from '@aiontheballot/observability/dsn';
import { captureException, flush } from '@sentry/node';
import { sql } from 'kysely';

import { initErrorTracking } from './error-tracking.js';

/**
 * The daily anonymization of right-of-reply reports past their site's retention (editorial workflow H2.5; data model
 * §3.8; PLAN R149): `private.anonymize_expired_reports()`, which nulls every personal field of each report whose
 * `anonymize_after` has come. Run by the API chart's CronJob from the API's image, as aiontheballot_worker, the one role
 * that may execute it, and never in the API's own process (ADR-0003 §1). It prints a count only.
 *
 *   node dist/anonymize-expired-reports.js
 */
const url = process.env.WORKER_DATABASE_URL;
if (!url) {
  console.error('WORKER_DATABASE_URL is not set');
  process.exit(1);
}
initErrorTracking(readDsn(process.env));
const db = createDatabase({
  connectionString: url,
  maxConnections: 1,
  applicationName: 'aiontheballot-report-anonymization',
});
try {
  const { rows } = await sql<{ anonymized: number }>`
    SELECT private.anonymize_expired_reports() AS anonymized`.execute(db);
  console.log(
    JSON.stringify({ msg: 'Anonymized expired reports', count: rows[0]?.anonymized ?? 0 }),
  );
} catch (error) {
  // By its class only: nothing of a report.
  const { code } = (error ?? {}) as { code?: unknown };
  console.error(
    `Anonymizing expired reports failed: ${typeof code === 'string' ? code : 'unknown'}`,
  );
  captureException(
    new Error(
      `Anonymizing expired reports failed: SQLSTATE ${typeof code === 'string' ? code : 'unknown'}`,
    ),
  );
  await flush(2_000);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
