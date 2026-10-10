import { createFileStore } from '@aiontheballot/db/file-store';
import {
  DEFAULT_GRACE_DAYS,
  fileKey,
  parseLedger,
  parseSweepInput,
  planSweep,
  SWEEP_LIST_SQL,
  wasRestored,
} from '@aiontheballot/db/file-sweep';
import { stat } from 'node:fs/promises';

/**
 * The orphan-bytes sweep (ADR-0004 §5). Standard input is the owner's list of every file row, brand asset and deleted
 * file (`--print-query` prints the query), which no runtime role can read, piped from Postgres:
 *
 *   kubectl exec deploy/aiontheballot-api -- node dist/sweep-files.js --print-query > sweep.sql
 *   kubectl exec -i postgresql-0 -c postgres -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" PGOPTIONS="-c row_security=off" \
 *     psql -X -U postgres -d aiontheballot' < sweep.sql \
 *     | kubectl exec -i deploy/aiontheballot-api -- node dist/sweep-files.js [--delete] [--grace-days N] [--allow-many]
 *
 * Every run records when it first saw each stored file unnamed. Only with --delete does it delete files no row has
 * named for longer than the grace period (120 days by default, never less than 111), and never a file stored or reused
 * within a day of the list's snapshot. It refuses a list cut short, a list that names nothing while files are stored,
 * and a list naming files the volume lacks (another database, or a wrong volume), and it deletes more than half the
 * stored files only with --allow-many. One sweep runs at a time. After a database restore (its identity changed, or its
 * audit log went back), every clock starts again and the run deletes nothing, --delete or not.
 */
const USAGE =
  "usage: sweep-files.js --print-query | <the query's output> | sweep-files.js [--delete] [--grace-days N] [--allow-many]";
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
const graceAt = args.indexOf('--grace-days');
const graceDays = graceAt < 0 ? DEFAULT_GRACE_DAYS : Number(args[graceAt + 1]);
const known = (graceAt < 0 ? 0 : 2) + (remove ? 1 : 0) + (allowMany ? 1 : 0);
if (args.length !== known || !Number.isInteger(graceDays)) {
  fail(USAGE);
}
const root = process.env.FILES_ROOT || fail('FILES_ROOT is not set');
// A mistyped root, or a volume not mounted, would look like an empty store.
if (!(await stat(root).catch(() => undefined))?.isDirectory()) {
  fail(`${root} is not a folder: is the volume mounted?`);
}

let text = '';
for await (const chunk of process.stdin) {
  text += String(chunk);
}
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
} catch (error) {
  await release?.();
  release = undefined;
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await release?.();
}
