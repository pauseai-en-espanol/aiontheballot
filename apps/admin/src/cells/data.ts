import { cache } from 'react';

import type { Localized, TenantRole } from '@/data';

import { readApi, tenantPath } from '@/data';

/**
 * The admin's reads of an election's cells (editorial workflow §8), from server components. The API reads them under
 * RLS; these shapes only say what the pages expect.
 */

export type Rating =
  'meets' | 'partially_meets' | 'does_not_meet' | 'green' | 'yellow' | 'red' | 'not_mentioned';

export type ChangeKind = 'initial' | 'update' | 'correction' | 'withdrawal';
export type WorkingState = 'none' | 'draft' | 'in_review' | 'published' | 'published_with_draft';

export interface GridCell {
  partyId: string;
  criterionId: string;
  assessmentId: string | null;
  working: WorkingState;
  published: { rating: Rating | null; revisionNo: number } | null;
  rejection: { note: string | null } | null;
  recheck: boolean;
}

export interface CellGrid {
  election: { id: string; slug: string; name: Localized; status: 'draft' | 'live' | 'archived' };
  parties: { id: string; slug: string; name: Localized; shortName: Localized; retired: boolean }[];
  criteria: {
    id: string;
    slug: string;
    title: Localized;
    shortTitle: Localized | null;
    retired: boolean;
  }[];
  cells: GridCell[];
  roles: TenantRole[];
  platformAdmin: boolean;
}

export interface CellSource {
  id: string;
  title: string;
  kind: string;
  language: string | null;
}

export interface Cell {
  party: { id: string; slug: string; name: Localized; shortName: Localized; retired: boolean };
  criterion: {
    id: string;
    slug: string;
    title: Localized;
    shortTitle: Localized | null;
    retired: boolean;
  };
  electionStatus: 'draft' | 'live' | 'archived';
  requireSecondReviewer: boolean;
  draft: {
    id: string;
    state: 'draft' | 'in_review' | 'published';
    generation: number;
    contentVersion: number;
    rating: Rating | null;
    summary: Localized | null;
    changeKind: ChangeKind | null;
    publicNote: Localized | null;
    recheckReason: string | null;
    quotes: {
      id: string;
      ordinal: number;
      quote: string;
      sectionLabel: string | null;
      source: CellSource;
      matchStatus: 'unmatched' | 'matched' | 'attested';
      location: string | null;
    }[];
    checkedDocuments: { source: CellSource; checkedAt: string; checkedBy: string }[];
    events: {
      kind: 'submitted' | 'recalled' | 'approved' | 'rejected' | 'commented';
      actorId: string;
      note: string | null;
      createdAt: string;
    }[];
    contributors: string[];
  } | null;
  revisions: {
    revisionNo: number;
    rating: Rating | null;
    summary: Localized | null;
    changeKind: ChangeKind;
    publicNote: Localized | null;
    publishedAt: string;
  }[];
  sources: (CellSource & {
    partyId: string | null;
    isProgramme: boolean;
    citable: boolean;
    admittedForQuotes: boolean;
    admittedForChecks: boolean;
  })[];
  /** Names of the people the trail names, by id; null for an account that no longer exists. */
  names: Record<string, string | null>;
  roles: TenantRole[];
  platformAdmin: boolean;
  /** The signed-in user's id, to tell their own work apart (four-eyes, C7.2). */
  you: string;
}

const shaped = <T>(value: unknown, keys: readonly string[], what: string): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || !keys.every((key) => key in value)) {
    throw new Error(`The API's answer for ${what} isn't what the admin expects`);
  }
  return value as T;
};

export const cellsPath = (tenant: string, election: string) =>
  `${tenantPath(tenant)}/e/${encodeURIComponent(election)}/cells`;

/** The election's grid (C1.1). */
export const getCellGrid = cache(async (tenant: string, election: string) =>
  shaped<CellGrid>(
    await readApi(cellsPath(tenant, election)),
    ['parties', 'criteria', 'cells'],
    'the cells',
  ),
);

/** One cell by its party and criterion (C2–C12). */
export const getCell = cache(
  async (tenant: string, election: string, party: string, criterion: string) =>
    shaped<Cell>(
      await readApi(
        `${cellsPath(tenant, election)}/${encodeURIComponent(party)}/${encodeURIComponent(criterion)}`,
      ),
      ['party', 'criterion', 'draft', 'sources'],
      'a cell',
    ),
);
