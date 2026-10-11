import { cache } from 'react';

import type { Localized } from '@/data';

import { readApi, tenantPath } from '@/data';

/**
 * The admin's reads of a tenant's elections and their structure (editorial workflow §6), from server components. The
 * API reads it all under RLS; these shapes only say what the pages expect.
 */

export type ElectionStatus = 'draft' | 'live' | 'archived';
export type ElectionType = 'general' | 'european' | 'regional' | 'municipal' | 'other';

export interface ElectionSummary {
  id: string;
  slug: string;
  name: Localized;
  type: ElectionType;
  territoryCode: string | null;
  /** `YYYY-MM-DD`, or null while unknown. */
  date: string | null;
  status: ElectionStatus;
  announced: boolean;
}

export interface Election extends ElectionSummary {
  requireSecondReviewer: boolean;
  frozenFrom: string | null;
  frozenUntil: string | null;
  wentLiveAt: string | null;
  counts: { parties: number; criteria: number; reviewers: number };
  hasMethodology: boolean;
}

/** What the user may do in an election's tenant, for what to offer; the database decides again. */
export interface Capabilities {
  /** Editors, country admins and platform admins write elections, parties and criteria. */
  canEdit: boolean;
  /** Country admins and platform admins write the methodology, announce and delete. */
  canAdminister: boolean;
  /** Only platform admins change four-eyes. */
  platformAdmin: boolean;
}

export type SourceKind =
  'pdf' | 'web_page' | 'social_post' | 'video' | 'audio' | 'party_submission';
export const SOURCE_KINDS: readonly SourceKind[] = [
  'pdf',
  'web_page',
  'social_post',
  'video',
  'audio',
  'party_submission',
];

export interface Methodology {
  id: string;
  kind: 'demands' | 'descriptive';
  demandsOwnerId: string | null;
  body: Localized;
  admissibleSourceKinds: SourceKind[];
  notMentionedSourceKinds: SourceKind[];
  reviewers: {
    id: string;
    name: string;
    affiliation: string;
    displayOrder: number;
    retired: boolean;
  }[];
  usage: Record<string, { quotes: number; checked: number }>;
}

export interface Party {
  id: string;
  slug: string;
  name: Localized;
  shortName: Localized;
  displayOrder: number;
  colour: string | null;
  website: string | null;
  territoryCodes: string[] | null;
  programmeStatus: 'pending' | 'published';
  retired: boolean;
}

export interface Criterion {
  id: string;
  slug: string;
  title: Localized;
  shortTitle: Localized | null;
  description: Localized;
  displayOrder: number;
  coreCriterionId: string | null;
  retired: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const shaped = <T>(value: unknown, keys: readonly string[], what: string): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value) || !keys.every((key) => key in value)) {
    throw new Error(`The API's answer for ${what} isn't what the admin expects`);
  }
  return value as T;
};

const electionPath = (tenant: string, election: string) =>
  `${tenantPath(tenant)}/e/${encodeURIComponent(election)}`;

export const getElections = cache(async (tenant: string) =>
  shaped<{ elections: ElectionSummary[]; canCreate: boolean }>(
    await readApi(`${tenantPath(tenant)}/elections`),
    ['elections', 'canCreate'],
    'the elections',
  ),
);

export const getElection = cache(async (tenant: string, election: string) =>
  shaped<{ election: Election } & Capabilities>(
    await readApi(electionPath(tenant, election)),
    ['election', 'canEdit'],
    'an election',
  ),
);

export const getMethodology = cache(async (tenant: string, election: string) =>
  shaped<{
    methodology: Methodology | null;
    demandsOwners: { id: string; name: Localized; role: 'operator' | 'endorser' }[];
    kind: 'demands' | 'descriptive';
    canEdit: boolean;
  }>(
    await readApi(`${electionPath(tenant, election)}/methodology`),
    ['methodology', 'canEdit'],
    'a methodology',
  ),
);

export const getParties = cache(async (tenant: string, election: string) =>
  shaped<{ parties: Party[]; canEdit: boolean }>(
    await readApi(`${electionPath(tenant, election)}/parties`),
    ['parties', 'canEdit'],
    'the parties',
  ),
);

export const getCriteria = cache(async (tenant: string, election: string) =>
  shaped<{
    criteria: Criterion[];
    coreCriteria: { id: string; key: string; title: Localized }[];
    canEdit: boolean;
  }>(
    await readApi(`${electionPath(tenant, election)}/criteria`),
    ['criteria', 'canEdit'],
    'the criteria',
  ),
);

export interface GoLiveChecklist {
  needs: {
    activeTenant: boolean;
    operator: boolean;
    methodology: boolean;
    electionName: boolean;
    methodologyText: boolean;
    partiesMissingNames: string[];
    criteriaMissingTexts: string[];
  };
  warnings: {
    noParties: boolean;
    noCriteria: boolean;
    noReviewers: boolean;
    unpublishedTexts: ('privacy_policy' | 'right_of_reply_policy' | 'about_operator')[];
  };
  ready: boolean;
}

/** What going live needs, as the database will check it, and what it warns about (E5.2, E5.3). */
export const getChecklist = cache(async (tenant: string, election: string) =>
  shaped<GoLiveChecklist>(
    await readApi(`${electionPath(tenant, election)}/checklist`),
    ['needs', 'warnings', 'ready'],
    'the go-live checklist',
  ),
);
