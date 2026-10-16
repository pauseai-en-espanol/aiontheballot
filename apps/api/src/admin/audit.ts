import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

/**
 * The audit view (editorial workflow H3; PLAN R150), read in the member's `withActor` transaction: RLS shows a site's
 * entries to its country admins and every entry to platform admins (H3.1), and the audit trigger never writes personal
 * data into them (H3.2). Newest first, a page at a time, filtered by actor, table, row and time (H3.3).
 */
export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  table: string;
  rowId: string;
  /** What changed: `old` and `new` values by column, without personal-data columns. */
  diff: unknown;
}

export interface AuditFilter {
  /** A site's entries, or the platform's own (no site): null. */
  tenantId: string | null;
  actorId?: string;
  table?: string;
  rowId?: string;
  /** From this instant, inclusive, to that one, exclusive. */
  from?: string;
  until?: string;
  /** Entries older than this id: the next page. */
  before?: string;
}

export const AUDIT_PAGE = 50;

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

export const listAudit = async (
  trx: Transaction<DB>,
  filter: AuditFilter,
): Promise<{ entries: AuditEntry[]; next: string | null; tables: string[] }> => {
  let query = trx
    .selectFrom('app.audit_log')
    .select([
      sql<string>`id::text`.as('id'),
      instant('at').as('at'),
      'actor_id',
      'action',
      'table_name',
      'row_id',
      'diff',
    ]);
  query =
    filter.tenantId === null
      ? query.where('tenant_id', 'is', null)
      : query.where('tenant_id', '=', filter.tenantId);
  if (filter.actorId) {
    query = query.where('actor_id', '=', filter.actorId);
  }
  if (filter.table) {
    query = query.where('table_name', '=', filter.table);
  }
  if (filter.rowId) {
    query = query.where('row_id', '=', filter.rowId);
  }
  if (filter.from) {
    query = query.where('at', '>=', sql<Date>`${filter.from}::timestamptz`);
  }
  if (filter.until) {
    query = query.where('at', '<', sql<Date>`${filter.until}::timestamptz`);
  }
  if (filter.before) {
    query = query.where(sql<boolean>`id < ${filter.before}::bigint`);
  }
  const rows = await query
    .orderBy('id', 'desc')
    .limit(AUDIT_PAGE + 1)
    .execute();
  const page = rows.slice(0, AUDIT_PAGE);
  const tables = await trx
    .selectFrom('app.audit_log')
    .select('table_name')
    .distinct()
    .where((eb) =>
      filter.tenantId === null
        ? eb('tenant_id', 'is', null)
        : eb('tenant_id', '=', filter.tenantId),
    )
    .orderBy('table_name')
    .execute();
  return {
    entries: page.map((row) => ({
      id: row.id,
      at: row.at,
      actorId: row.actor_id,
      action: row.action,
      table: row.table_name,
      rowId: row.row_id,
      diff: row.diff,
    })),
    next: rows.length > AUDIT_PAGE ? (page.at(-1)?.id ?? null) : null,
    tables: tables.map((row) => row.table_name),
  };
};

/** A real day, `YYYY-MM-DD`: not one JavaScript rolls over (2026-02-31). */
const isDay = (value: string): boolean => {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

/**
 * The filter a request's query gives (H3.3): whole days in UTC, from the first's start to the end of the last (the
 * next day's start, exclusive). A day that isn't one is left out.
 */
export const auditFilter = (
  tenantId: string | null,
  query: {
    actor?: string;
    table?: string;
    row?: string;
    from?: string;
    to?: string;
    before?: string;
  },
): AuditFilter => {
  const next = (day: string) => {
    const date = new Date(`${day}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  };
  return {
    tenantId,
    ...(query.actor ? { actorId: query.actor } : {}),
    ...(query.table ? { table: query.table } : {}),
    ...(query.row ? { rowId: query.row } : {}),
    ...(query.from && isDay(query.from) ? { from: `${query.from}T00:00:00Z` } : {}),
    ...(query.to && isDay(query.to) ? { until: next(query.to) } : {}),
    ...(query.before ? { before: query.before } : {}),
  };
};
