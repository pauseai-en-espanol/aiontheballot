import { FILE_BUCKETS, type FileSpace, isTenantId } from './file-store.js';

/**
 * The orphan-bytes sweep (ADR-0004 §5): bytes on the volume that no row names are deleted only once no row has named
 * them for a grace period at least as long as the oldest database backup that could be restored, so a restored dump
 * never names bytes that are gone. Two records say since when a file has gone unnamed, and the later one counts:
 *
 * - the audit log, which keeps every deleted file row (its tenant, bucket and hash) for good: the last time a row
 *   naming a file was deleted;
 * - a ledger on the volume, of when the sweep first saw each file unnamed, for bytes no row ever named (an upload
 *   whose transaction failed). A file's own dates say when it was written, not when its row went away.
 */

/**
 * The owner's query (run as `postgres`, with row security off, so it errors rather than shows less): every file row
 * and brand asset, the last deletion of each key a deleted row named (from the audit log, which keeps them for good),
 * and the line count and snapshot time, all from one snapshot.
 */
export const SWEEP_LIST_SQL = `COPY (
  WITH named AS (
    SELECT tenant_id || ' ' || bucket || ' ' || sha256 AS line FROM app.files
    UNION ALL
    SELECT 'platform ' || sha256 FROM app.brand_assets
    UNION ALL
    SELECT 'deleted '
           || CASE WHEN a.table_name = 'files'
                   THEN (a.diff -> 'old' ->> 'tenant_id') || ' ' || (a.diff -> 'old' ->> 'bucket') || ' '
                   ELSE 'platform ' END
           || (a.diff -> 'old' ->> 'sha256') || ' '
           || to_char(max(a.at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      FROM app.audit_log a
     WHERE a.action = 'delete' AND a.table_name IN ('files', 'brand_assets')
     GROUP BY a.table_name, a.diff -> 'old' ->> 'tenant_id', a.diff -> 'old' ->> 'bucket', a.diff -> 'old' ->> 'sha256'
  )
  SELECT line FROM (
    SELECT 0 AS k, line FROM named
    UNION ALL
    SELECT 1, 'end ' || (SELECT count(*) FROM named) || ' ' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) l ORDER BY k
) TO STDOUT`;

/** Every byte file's key: `{tenant_id}/{bucket}/{sha256}`, or `platform/{sha256}` for a brand asset. */
export const fileKey = (space: FileSpace, sha256: string): string =>
  space === 'platform' ? `platform/${sha256}` : `${space.tenantId}/${space.bucket}/${sha256}`;

/**
 * The oldest restorable dump, with the cluster's backup plan (gitops, PLAN R67): weekly Velero backups kept 90 days,
 * each holding the last 14 nightly dumps, plus a week for backups expiring late. A sweep never runs with less, and
 * this must follow the plan if its retention grows.
 */
export const MIN_GRACE_DAYS = 111;
export const DEFAULT_GRACE_DAYS = 120;

const DAY_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/;
/** An instant as the owner's query prints it, and as the ledger keeps it: UTC, to the second or finer. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const parseInstant = (text: string | undefined, what: string): Date => {
  if (!text || !INSTANT.test(text) || Number.isNaN(Date.parse(text))) {
    throw new Error(`Not an instant (${what}): ${JSON.stringify(text)}`);
  }
  return new Date(text);
};

/** A named file's key from its words: `{tenant_id} {bucket} {sha256}`, or `platform {sha256}`. */
const keyOf = (words: readonly string[], line: string): string => {
  if (words.length === 2 && words[0] === 'platform' && SHA256.test(words[1] ?? '')) {
    return `platform/${words[1]}`;
  }
  if (
    words.length === 3 &&
    isTenantId(words[0] ?? '') &&
    FILE_BUCKETS.some((bucket) => bucket === words[1]) &&
    SHA256.test(words[2] ?? '')
  ) {
    return words.join('/');
  }
  throw new Error(`Not a named file: ${JSON.stringify(line)}`);
};

export interface SweepInput {
  /** The keys rows name now. */
  named: Set<string>;
  /** For each key a deleted row named, the last time one was deleted. */
  deletedAt: Map<string, Date>;
  /** When the database's snapshot was taken. */
  snapshot: Date;
}

/**
 * The output of SWEEP_LIST_SQL: one line per file row or brand asset (`{tenant_id}
 * {bucket} {sha256}`, `platform {sha256}`), one per key a deleted row named (`deleted {key words} {instant}`), then
 * `end {count of lines before it} {snapshot instant}`. Anything else, a missing or wrong count, or anything after it,
 * is refused: a list cut short would make named bytes look unnamed.
 */
export const parseSweepInput = (text: string): SweepInput => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines.pop() ?? '';
  const [, total, at] = /^end (\d+) (\S+)$/.exec(last) ?? [];
  if (total === undefined) {
    throw new Error(
      'The list of named files has no "end <count> <snapshot>" line: it may be cut short',
    );
  }
  if (Number(total) !== lines.length) {
    throw new Error(`The list of named files says ${total} lines but has ${lines.length}`);
  }
  const input: SweepInput = {
    named: new Set(),
    deletedAt: new Map(),
    snapshot: parseInstant(at, 'the snapshot'),
  };
  for (const line of lines) {
    const words = line.split(' ');
    if (words[0] === 'deleted') {
      const when = parseInstant(words.at(-1), line);
      const key = keyOf(words.slice(1, -1), line);
      if (when > (input.deletedAt.get(key) ?? new Date(0))) {
        input.deletedAt.set(key, when);
      }
    } else {
      input.named.add(keyOf(words, line));
    }
  }
  return input;
};

/** When the sweep first saw each stored key unnamed. */
export interface SweepLedger {
  version: 1;
  unnamedSince: Record<string, string>;
}

export const EMPTY_LEDGER: SweepLedger = { version: 1, unnamedSince: {} };

/** The ledger as written, refused if it isn't one this version wrote or holds a date after `now`. */
export const parseLedger = (text: string | undefined, now: Date): SweepLedger => {
  if (text === undefined) {
    return EMPTY_LEDGER;
  }
  const ledger = JSON.parse(text) as SweepLedger;
  if (
    ledger.version !== 1 ||
    typeof ledger.unnamedSince !== 'object' ||
    ledger.unnamedSince === null
  ) {
    throw new Error('The sweep ledger is not one this version wrote');
  }
  for (const [key, since] of Object.entries(ledger.unnamedSince)) {
    // A date ahead of the clock means one of the two is wrong: nothing is decided on either.
    if (parseInstant(since, key) > now) {
      throw new Error(`The sweep ledger dates ${key} in the future (${since}): check the clock`);
    }
  }
  return ledger;
};

export interface SweepPlan {
  /** Keys no row has named for longer than the grace period: what a sweep deletes. */
  expired: string[];
  /** Keys unnamed for less than that, kept for now. */
  waiting: string[];
  /** Keys rows name that the volume lacks: a list from another database, or bytes lost. */
  missing: string[];
  /** The ledger to keep: only keys still stored and still unnamed, each since it went unnamed. */
  ledger: SweepLedger;
}

/**
 * Compares what is stored with what rows name. A file is unnamed since the later of when the sweep first saw it so
 * and when a row naming it was last deleted, so a file named again and dropped again starts its wait over. A key named
 * again leaves the ledger.
 */
export const planSweep = (
  stored: readonly string[],
  input: Pick<SweepInput, 'named' | 'deletedAt'>,
  previous: SweepLedger,
  now: Date,
  graceDays: number,
): SweepPlan => {
  if (graceDays < MIN_GRACE_DAYS) {
    throw new Error(
      `A grace period of ${graceDays} days is shorter than the oldest restorable dump (${MIN_GRACE_DAYS})`,
    );
  }
  const cutoff = now.getTime() - graceDays * DAY_MS;
  const unnamedSince: Record<string, string> = {};
  const expired: string[] = [];
  const waiting: string[] = [];
  for (const key of stored) {
    if (input.named.has(key)) {
      continue;
    }
    const seen = previous.unnamedSince[key]
      ? Date.parse(previous.unnamedSince[key])
      : now.getTime();
    const since = new Date(Math.max(seen, input.deletedAt.get(key)?.getTime() ?? 0));
    unnamedSince[key] = since.toISOString();
    (since.getTime() <= cutoff ? expired : waiting).push(key);
  }
  const held = new Set(stored);
  const missing = [...input.named].filter((key) => !held.has(key));
  return {
    expired: expired.sort(),
    waiting: waiting.sort(),
    missing: missing.sort(),
    ledger: { version: 1, unnamedSince },
  };
};
