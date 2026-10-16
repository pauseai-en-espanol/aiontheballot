import { cache } from 'react';

import type { Localized } from '@/data';

import { readApi, tenantPath } from '@/data';

/**
 * The admin's reads of a site's right-of-reply reports (editorial workflow H2), from server components. The API reads
 * them under RLS (editors, reviewers and country admins; never platform admins); these shapes only say what the pages
 * expect. Report contents are personal data: shown to members, never logged.
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
  cell: { party: string; partyName: Localized; criterion: string; criterionName: Localized } | null;
  partyRepresentative: boolean;
  anonymized: boolean;
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
  anonymizeAfter: string;
  changeRequests: {
    id: string;
    election: string;
    targetKind: string;
    action: string;
    state: string;
    proposedAt: string;
  }[];
  corrections: {
    election: string;
    party: string;
    criterion: string;
    revisionNo: number;
    publishedAt: string;
  }[];
}

export interface ReportList {
  reports: ReportSummary[];
  counts: Record<ReportStatus, number>;
  canTriage: boolean;
  canAnonymize: boolean;
  platformAdmin: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const reportsPath = (tenant: string) => `${tenantPath(tenant)}/reports`;

/** The site's reports, in one status or all. */
export const getReports = cache(
  async (tenant: string, status?: ReportStatus): Promise<ReportList | undefined> => {
    const body = await readApi(`${reportsPath(tenant)}${status ? `?status=${status}` : ''}`);
    if (body === undefined) {
      return undefined;
    }
    if (!isObject(body) || !Array.isArray(body.reports) || !isObject(body.counts)) {
      throw new Error('The API answered something other than the reports');
    }
    return body as unknown as ReportList;
  },
);

/** One report in full, and who may do what with it. */
export const getReport = cache(
  async (
    tenant: string,
    id: string,
  ): Promise<
    | {
        report: ReportDetail;
        names: Record<string, string | null>;
        canTriage: boolean;
        canAnonymize: boolean;
      }
    | undefined
  > => {
    const body = await readApi(`${reportsPath(tenant)}/${encodeURIComponent(id)}`);
    if (body === undefined) {
      return undefined;
    }
    if (!isObject(body) || !isObject(body.report)) {
      throw new Error('The API answered something other than a report');
    }
    return body as unknown as {
      report: ReportDetail;
      names: Record<string, string | null>;
      canTriage: boolean;
      canAnonymize: boolean;
    };
  },
);
