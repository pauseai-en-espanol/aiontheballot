import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';

import { sql, type Transaction } from 'kysely';

/**
 * Right-of-reply reports (editorial workflow H2), read and triaged in the member's `withActor` transaction: RLS shows a
 * tenant's reports to its editors, reviewers and country admins, never to platform admins (PLAN P11), and the report
 * rules decide every change: new → triaged → accepted, rejected or spam, each once; only the status and the internal
 * resolution note change; anonymizing nulls every personal field at once, by a country admin. Report contents are
 * personal data: they never reach a log, an error report or the audit log.
 */

export type ReportStatus = 'new' | 'triaged' | 'accepted' | 'rejected' | 'spam';
export const REPORT_STATUSES: readonly ReportStatus[] = [
  'new',
  'triaged',
  'accepted',
  'rejected',
  'spam',
];

export interface ReportSummary {
  id: string;
  kind: 'error_report' | 'party_response';
  status: ReportStatus;
  createdAt: string;
  election: { slug: string; name: Localized } | null;
  /** The cell it is about, when the form named a published one. */
  cell: { party: string; partyName: Localized; criterion: string; criterionName: Localized } | null;
  partyRepresentative: boolean;
  anonymized: boolean;
  /** The message's first words, for the queue; null once anonymized. */
  excerpt: string | null;
}

export interface ReportDetail extends ReportSummary {
  name: string | null;
  email: string | null;
  organization: string | null;
  message: string | null;
  resolutionNote: string | null;
  triagedBy: string | null;
  triagedAt: string | null;
  /** The day its personal data is removed, as the site's retention says (T3). */
  anonymizeAfter: string;
  /** Change requests that cite it (CR1.8). */
  changeRequests: {
    id: string;
    election: string;
    targetKind: string;
    action: string;
    state: string;
    proposedAt: string;
  }[];
  /** Published corrections that cite it (C10.4). */
  corrections: {
    election: string;
    party: string;
    criterion: string;
    revisionNo: number;
    publishedAt: string;
  }[];
}

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;
const EXCERPT = 160;

const summaryColumns = [
  'r.id',
  'r.kind',
  'r.status',
  instant('r.created_at').as('created_at'),
  'e.slug as election_slug',
  'e.name as election_name',
  'p.slug as party_slug',
  'p.name as party_name',
  'c.slug as criterion_slug',
  'c.title as criterion_title',
  'r.is_party_representative',
  sql<boolean>`r.anonymized_at IS NOT NULL`.as('anonymized'),
  sql<string | null>`left(r.message, ${EXCERPT})`.as('excerpt'),
] as const;

/** The reports RLS shows the actor, with what they are about. */
const reportsQuery = (trx: Transaction<DB>, tenantId: string) =>
  trx
    .selectFrom('app.reports as r')
    .leftJoin('app.elections as e', 'e.id', 'r.election_id')
    .leftJoin('app.assessments as a', 'a.id', 'r.assessment_id')
    .leftJoin('app.parties as p', 'p.id', 'a.party_id')
    .leftJoin('app.criteria as c', 'c.id', 'a.criterion_id')
    .where('r.tenant_id', '=', tenantId);

type SummaryRow = {
  id: string;
  kind: ReportSummary['kind'];
  status: ReportStatus;
  created_at: string;
  election_slug: string | null;
  election_name: Localized | null;
  party_slug: string | null;
  party_name: Localized | null;
  criterion_slug: string | null;
  criterion_title: Localized | null;
  is_party_representative: boolean;
  anonymized: boolean;
  excerpt: string | null;
};

const summary = (row: SummaryRow): ReportSummary => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  createdAt: row.created_at,
  election:
    row.election_slug && row.election_name
      ? { slug: row.election_slug, name: row.election_name }
      : null,
  cell:
    row.party_slug && row.party_name && row.criterion_slug && row.criterion_title
      ? {
          party: row.party_slug,
          partyName: row.party_name,
          criterion: row.criterion_slug,
          criterionName: row.criterion_title,
        }
      : null,
  partyRepresentative: row.is_party_representative,
  anonymized: row.anonymized,
  excerpt: row.excerpt,
});

/** The queue: one status's reports, or every report, newest first; new ones before the rest when unfiltered. */
export const listReports = async (
  trx: Transaction<DB>,
  tenantId: string,
  status?: ReportStatus,
): Promise<ReportSummary[]> => {
  let query = reportsQuery(trx, tenantId).select(summaryColumns);
  if (status !== undefined) {
    query = query.where('r.status', '=', status);
  }
  const rows = await query
    .orderBy(sql`r.status = 'new'`, 'desc')
    .orderBy('r.created_at', 'desc')
    .limit(500)
    .execute();
  return rows.map((row) => summary(row as SummaryRow));
};

/** How many reports wait in each status, for the queue's filters. */
export const reportCounts = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<Record<ReportStatus, number>> => {
  const rows = await trx
    .selectFrom('app.reports')
    .select(['status', sql<number>`count(*)::int`.as('count')])
    .where('tenant_id', '=', tenantId)
    .groupBy('status')
    .execute();
  return Object.fromEntries(
    REPORT_STATUSES.map((status) => [
      status,
      rows.find((row) => row.status === status)?.count ?? 0,
    ]),
  ) as Record<ReportStatus, number>;
};

/** One report in full, with the change requests and corrections that cite it. */
export const getReport = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<ReportDetail | undefined> => {
  const row = await reportsQuery(trx, tenantId)
    .select([
      ...summaryColumns,
      'r.name',
      'r.email',
      'r.organization',
      'r.message',
      'r.resolution_note',
      'r.triaged_by',
      instant('r.triaged_at').as('triaged_at'),
      sql<string>`r.anonymize_after::text`.as('anonymize_after'),
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  const changeRequests = await trx
    .selectFrom('app.change_requests as q')
    .innerJoin('app.elections as e', 'e.id', 'q.election_id')
    .select([
      'q.id',
      'e.slug as election',
      'q.target_kind',
      'q.action',
      'q.state',
      instant('q.proposed_at').as('proposed_at'),
    ])
    .where('q.tenant_id', '=', tenantId)
    .where('q.report_id', '=', id)
    .orderBy('q.proposed_at')
    .execute();
  const corrections = await trx
    .selectFrom('app.revision_internal as i')
    .innerJoin('app.assessment_revisions as v', 'v.id', 'i.revision_id')
    .innerJoin('app.elections as e', 'e.id', 'v.election_id')
    .innerJoin('app.parties as p', 'p.id', 'v.party_id')
    .innerJoin('app.criteria as c', 'c.id', 'v.criterion_id')
    .select([
      'e.slug as election',
      'p.slug as party',
      'c.slug as criterion',
      'v.revision_no',
      instant('v.published_at').as('published_at'),
    ])
    .where('i.tenant_id', '=', tenantId)
    .where('i.report_id', '=', id)
    .orderBy('v.published_at')
    .execute();
  return {
    ...summary(row as SummaryRow),
    name: row.name,
    email: row.email,
    organization: row.organization,
    message: row.message,
    resolutionNote: row.resolution_note,
    triagedBy: row.triaged_by,
    triagedAt: row.triaged_at,
    anonymizeAfter: row.anonymize_after,
    changeRequests: changeRequests.map((q) => ({
      id: q.id,
      election: q.election,
      targetKind: q.target_kind,
      action: q.action,
      state: q.state,
      proposedAt: q.proposed_at,
    })),
    corrections: corrections.map((v) => ({
      election: v.election,
      party: v.party,
      criterion: v.criterion,
      revisionNo: v.revision_no,
      publishedAt: v.published_at,
    })),
  };
};

/**
 * Moves a report on (H2.2), with the internal resolution note when one is given (H2.3): the report rules allow only
 * new → triaged → accepted, rejected or spam, and stamp who triaged it and when. False when RLS shows no such report.
 */
export const triageReport = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
  status: Exclude<ReportStatus, 'new'>,
  resolutionNote: string | null | undefined,
): Promise<boolean> => {
  // Decided straight from "new" (admin forms §2, reports; PLAN R196): triaged first, in the same transaction, as the
  // report rules require (R16), so the database still sees, and stamps, both steps.
  if (status !== 'triaged') {
    await trx
      .updateTable('app.reports')
      .set({ status: 'triaged' })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .where('status', '=', 'new')
      .execute();
  }
  return (
    (
      await trx
        .updateTable('app.reports')
        .set({
          status,
          ...(resolutionNote === undefined ? {} : { resolution_note: resolutionNote }),
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id)
        .executeTakeFirst()
    ).numUpdatedRows > 0n
  );
};

/**
 * Removes every personal field of a report at once (H2.5), as an erasure request asks: country admins only, which the
 * report rules check. False when RLS shows no such report.
 */
export const anonymizeReport = async (
  trx: Transaction<DB>,
  tenantId: string,
  id: string,
): Promise<boolean> =>
  (
    await trx
      .updateTable('app.reports')
      .set({
        name: null,
        email: null,
        organization: null,
        message: null,
        resolution_note: null,
        anonymized_at: sql`now()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst()
  ).numUpdatedRows > 0n;
