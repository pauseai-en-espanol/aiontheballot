import { cache } from 'react';

import { readApi } from '@/data';

/** The audit view's entries (editorial workflow H3; PLAN R150), as the API reads them under RLS. */
export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  table: string;
  rowId: string;
  diff: unknown;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** The next page's cursor, if there are older entries. */
  next: string | null;
  /** The tables the log holds entries of, for the filter. */
  tables: string[];
  /** Actors' names, members only (R94). */
  names: Record<string, string | null>;
  /** The site's members, for the filter. */
  members: Record<string, string | null>;
}

export const AUDIT_FILTERS = ['actor', 'table', 'row', 'from', 'to', 'before'] as const;
export type AuditQuery = Partial<Record<(typeof AUDIT_FILTERS)[number], string>>;

/** The filters a page's query gives, as the API takes them; anything else is left out. */
export const auditQuery = (query: Record<string, string | string[] | undefined>): AuditQuery =>
  Object.fromEntries(
    AUDIT_FILTERS.flatMap((key) => {
      const value = query[key];
      return typeof value === 'string' && value !== '' ? [[key, value]] : [];
    }),
  );

export const getAudit = cache(
  async (path: string, query: AuditQuery): Promise<AuditPage | undefined> => {
    const search = new URLSearchParams(query as Record<string, string>).toString();
    const body = await readApi(`${path}${search ? `?${search}` : ''}`);
    if (body === undefined) {
      return undefined;
    }
    const page = body as Partial<AuditPage>;
    if (!Array.isArray(page.entries) || !Array.isArray(page.tables)) {
      throw new Error('The API answered something other than an audit page');
    }
    return page as AuditPage;
  },
);
