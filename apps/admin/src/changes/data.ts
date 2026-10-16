import { cache } from 'react';

import type { Localized } from '@/data';

import { readApi, tenantPath } from '@/data';

/**
 * The admin's reads of an election's change requests (editorial workflow CR1), from server components. The API reads
 * them under RLS; these shapes only say what the pages expect.
 */

export type ChangeAction = 'update' | 'add' | 'retire';
export type ChangeTarget =
  'election' | 'methodology' | 'methodology_reviewer' | 'party' | 'criterion';

export interface ChangeRequest {
  id: string;
  action: ChangeAction;
  targetKind: ChangeTarget;
  targetId: string | null;
  field: string | null;
  previousValue: unknown;
  proposedValue: unknown;
  publicNote: Localized;
  state: 'pending' | 'approved' | 'rejected';
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  targetName: Localized | string | null;
}

export interface ChangeList {
  changes: ChangeRequest[];
  /** Editors and country admins propose and withdraw. */
  canPropose: boolean;
  /** Country admins and platform admins approve, which applies the change with their own rights (R24). */
  canApprove: boolean;
  /** Reviewers may reject too, though they can't approve (CR1.4). */
  canReject: boolean;
  /** Whether a proposer may approve their own proposal: the site doesn't require a second approver (CR1.5). */
  ownApprovals: boolean;
  /** Members' names by id (R94); null for an account that isn't the site's member. */
  names: Record<string, string | null>;
  you: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const changesPath = (tenant: string, election: string) =>
  `${tenantPath(tenant)}/e/${encodeURIComponent(election)}/changes`;

/** The election's change requests, pending first. */
export const getChanges = cache(
  async (tenant: string, election: string): Promise<ChangeList | undefined> => {
    const body = await readApi(changesPath(tenant, election));
    if (body === undefined) {
      return undefined;
    }
    if (!isObject(body) || !Array.isArray(body.changes) || !('canPropose' in body)) {
      throw new Error("The API's answer for the change requests isn't what the admin expects");
    }
    return body as unknown as ChangeList;
  },
);
