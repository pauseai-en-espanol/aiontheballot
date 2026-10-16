import { cache } from 'react';

import type { Localized, TenantRole } from '@/data';
import type { ElectionStatus } from '@/elections/data';

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
  election: { id: string; slug: string; name: Localized; status: ElectionStatus };
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
  electionStatus: ElectionStatus;
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
    /** The right-of-reply report the draft answers (C10.4), copied into its revision's private record on publish. */
    reportId: string | null;
    recheckReason: string | null;
    quotes: {
      id: string;
      ordinal: number;
      quote: string;
      sectionLabel: string | null;
      source: CellSource;
      matchStatus: 'unmatched' | 'matched' | 'attested';
      location: string | null;
      /** Who wrote it, who can't attest it while four-eyes is on (C4.2). */
      createdBy: string;
      /** Its source has text, so it is matched; otherwise it is attested (C4). */
      withText: boolean;
      attestationFile: { contentType: string; byteSize: number } | null;
      /** For video or audio, where in the clip it is said, in seconds. */
      clip: { start: number; end: number | null } | null;
      attestedBy: string | null;
    }[];
    checkedDocuments: { source: CellSource; checkedAt: string; checkedBy: string }[];
    events: {
      kind: 'submitted' | 'recalled' | 'approved' | 'rejected' | 'commented';
      actorId: string;
      note: string | null;
      createdAt: string;
    }[];
    contributors: string[];
    /** Who uploaded a copy or attestation file the draft cites: contributors too as four-eyes counts them. */
    uploaders: string[];
  } | null;
  revisions: {
    revisionNo: number;
    rating: Rating | null;
    summary: Localized | null;
    changeKind: ChangeKind;
    publicNote: Localized | null;
    publishedAt: string;
    /** Its private record (H1.1): who contributed and published it, whether self-reviewed, the report it answers. */
    internal: {
      contributors: string[];
      publisher: string;
      selfReviewed: boolean;
      reportId: string | null;
    } | null;
  }[];
  sources: (CellSource & {
    partyId: string | null;
    isProgramme: boolean;
    citable: boolean;
    admittedForQuotes: boolean;
    admittedForChecks: boolean;
    /** Its kind is listed for "not mentioned", whoever's it is (C5.2). */
    listedForChecks: boolean;
    /** Marked replaced (PLAN D14): it takes no new quote or check. An API from before it doesn't say. */
    replaced?: boolean;
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
