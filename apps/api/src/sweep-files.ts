import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore } from '@aiontheballot/db/file-store';
import {
  DEFAULT_GRACE_DAYS,
  fileKey,
  parseLedger,
  parseSweepInput,
  planSweep,
  SWEEP_LIST_QUERY,
  SWEEP_LIST_SQL,
  wasRestored,
} from '@aiontheballot/db/file-sweep';
import { readDsn } from '@aiontheballot/observability/dsn';
import { captureMessage, flush } from '@sentry/node';
import { sql } from 'kysely';
import { stat } from 'node:fs/promises';

import { initErrorTracking } from './error-tracking.js';

/**
 * The orphan-bytes sweep (ADR-0004 §5). It needs the list of every file row, brand asset and deleted file, which no
 * runtime role can read: `private.file_sweep_list()` gives it, to its own login only. On a schedule (PLAN R141), the
 * CronJob reads it with that login (`--from-database`, SWEEPER_DATABASE_URL); by hand, the owner pipes it in
 * (`--print-query` prints the query):
 *
 *   kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec deploy/aiontheballot-api -- \
 *     node dist/sweep-files.js --print-query > sweep.sql
 *   kubectl --context "$KUBE_CONTEXT" -n "$DATABASE_NAMESPACE" exec -i "$DATABASE_POD" -c postgres -- \
 *     sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -U postgres -d aiontheballot' < sweep.sql \
 *     | kubectl --context "$KUBE_CONTEXT" -n "$APP_NAMESPACE" exec -i deploy/aiontheballot-api -- \
 *       node dist/sweep-files.js [--delete] [--grace-days N] [--allow-many]
 *
 * Every run records when it first saw each stored file unnamed. Only with --delete does it delete files no row has
 * named for longer than the grace period (120 days by default, never less than 111), and never a file stored or reused
 * within a day of the list's snapshot. It refuses a list cut short, a list that names nothing while files are stored,
 * and a list naming files the volume lacks (another database, or a wrong volume), and it deletes more than half the
 * stored files only with --allow-many. One sweep runs at a time. After a database restore (its identity changed, or its
 * audit log went back), every clock starts again and the run deletes nothing, --delete or not.
 */
const USAGE =
  "usage: sweep-files.js --print-query | <the query's output> | sweep-files.js [--from-database] [--delete] [--grace-days N] [--allow-many]";
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--print-query') {
  console.log(`${SWEEP_LIST_SQL};`);
  process.exit(0);
}
const remove = args.includes('--delete');
const allowMany = args.includes('--allow-many');
const fromDatabase = args.includes('--from-database');
const graceAt = args.indexOf('--grace-days');
const graceDays = graceAt < 0 ? DEFAULT_GRACE_DAYS : Number(args[graceAt + 1]);
const known =
  (graceAt < 0 ? 0 : 2) + (remove ? 1 : 0) + (allowMany ? 1 : 0) + (fromDatabase ? 1 : 0);
if (args.length !== known || !Number.isInteger(graceDays)) {
  fail(USAGE);
}
// Unattended, on a schedule (--from-database): a refusal or a failure reaches error tracking, since a failed Job tells
// nobody. Its message says what was refused (counts, hashes, the database's own words), never anyone's data.
if (fromDatabase) {
  initErrorTracking(readDsn(process.env));
}
const report = async (message: string): Promise<never> => {
  console.error(message);
  if (fromDatabase) {
    captureMessage(`The scheduled file sweep stopped: ${message}`, 'error');
    await flush(2_000);
  }
  process.exit(1);
};
// Stopped by its deadline (SIGTERM): the file it is on is finished, the rest is left for the next run, and the lock is
// released, which an abrupt end would leave behind for every later run (and purge) to refuse.
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
});
const root = process.env.FILES_ROOT || fail('FILES_ROOT is not set');
// A mistyped root, or a volume not mounted, would look like an empty store.
if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
  fail(`${root} is not a folder: is the volume mounted?`);
}

/** The list, from the database as the sweep's own login, or from standard input. */
const readList = async (): Promise<string> => {
  if (fromDatabase) {
    const connectionString =
      process.env.SWEEPER_DATABASE_URL || (await report('SWEEPER_DATABASE_URL is not set'));
    const db = createDatabase({
      connectionString,
      maxConnections: 1,
      applicationName: 'aiontheballot-file-sweep',
    });
    try {
      const { rows } = await sql<{ line: string }>`${sql.raw(SWEEP_LIST_QUERY)}`.execute(db);
      return rows.map((row) => row.line).join('\n');
    } finally {
      await db.destroy();
    }
  }
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input;
};
const text = await readList().catch((error: unknown) =>
  // The database's own message (a refused grant, say), never the connection string.
  report(
    `The list of named files could not be read: ${error instanceof Error ? error.message : 'unknown'}`,
  ),
);
const store = createFileStore(root);
let release: (() => Promise<void>) | undefined;
try {
  release = await store.lockSweep();
  const now = new Date();
  const input = parseSweepInput(text);
  if (input.snapshot.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new Error(
      `The list's snapshot (${input.snapshot.toISOString()}) is in the future: check the clocks`,
    );
  }
  if (now.getTime() - input.snapshot.getTime() > DAY_MS) {
    throw new Error(`The list is from ${input.snapshot.toISOString()}: take a fresh one`);
  }
  // A sweep stopped halfway may have left files set aside: back to their places first.
  const recovered = await store.recoverRetired();
  const { stored, unexpected } = await store.list();
  const keys = stored.map(({ space, sha256 }) => fileKey(space, sha256));
  // A list from another database, or a store on the wrong volume: decide nothing, not even when the clocks start.
  if (input.named.size === 0 && keys.length > 0) {
    throw new Error(
      `The list names no file, but ${keys.length} are stored: is it from this database?`,
    );
  }
  const previous = parseLedger(await store.readLedger(), now);
  // Restored since the last run: the log forgot what happened after the dump. Every clock starts again, the new
  // ledger is kept, and nothing goes this time.
  const restored = wasRestored(previous, input);
  const deleting = remove && !restored;
  const plan = planSweep(
    keys,
    input,
    restored ? { version: 1, unnamedSince: {} } : previous,
    now,
    graceDays,
  );
  if (plan.missing.length > 0) {
    throw new Error(
      `${plan.missing.length} named files are not on this volume (${plan.missing.slice(0, 3).join(', ')}…): is the list from this database, and the volume this one?`,
    );
  }
  if (deleting && !allowMany && plan.expired.length > keys.length / 2) {
    throw new Error(
      `${plan.expired.length} of ${keys.length} stored files would go: pass --allow-many if that is right`,
    );
  }
  const expired = new Set(plan.expired);
  const outcomes = { deleted: 0, inUse: 0, gone: 0 };
  const settled = new Set<string>();
  if (deleting) {
    // Bytes stored or reused near the snapshot may belong to a row it didn't see yet.
    const inUseSince = new Date(input.snapshot.getTime() - DAY_MS);
    for (const { space, sha256 } of stored) {
      if (stopping) {
        break;
      }
      const key = fileKey(space, sha256);
      if (expired.has(key)) {
        const outcome = await store.retire(space, sha256, inUseSince);
        outcomes[outcome === 'kept' ? 'inUse' : outcome] += 1;
        if (outcome !== 'kept') {
          settled.add(key);
        }
      }
    }
  }
  const unnamedSince = Object.fromEntries(
    Object.entries(plan.ledger.unnamedSince).filter(([key]) => !settled.has(key)),
  );
  const ledger = {
    version: 1,
    unnamedSince,
    auditSequence: input.auditSequence,
    incarnation: input.incarnation,
  };
  await store.writeLedger(`${JSON.stringify(ledger, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        stored: keys.length,
        named: input.named.size,
        unnamedWaiting: plan.waiting.length,
        unnamedExpired: plan.expired.length,
        ...outcomes,
        recovered,
        restored,
        graceDays,
        unexpected,
      },
      null,
      2,
    ),
  );
  if (restored) {
    console.log(
      'The database was restored since the last sweep: every clock started again, and nothing was deleted.',
    );
  } else if (!remove && plan.expired.length > 0) {
    console.log(`Pass --delete to delete the ${plan.expired.length} expired files.`);
  }
  if (stopping) {
    throw new Error('Stopped by its deadline before it was done: the rest waits for the next run');
  }
} catch (error) {
  await release?.();
  release = undefined;
  await report(error instanceof Error ? error.message : String(error));
} finally {
  await release?.();
}
