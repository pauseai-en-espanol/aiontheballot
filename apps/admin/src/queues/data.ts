import { cache } from 'react';

import type { Localized } from '@/data';

import { readApi, tenantPath } from '@/data';

/**
 * A site's work queues (editorial workflow C1.2), from server components: what waits for the signed-in member, as the
 * API reads it under RLS. These shapes only say what the dashboard expects. A queue is null when it isn't the member's
 * to act on (their roles); each lists its first items and how many there are in all.
 */

export interface QueueElection {
  slug: string;
  name: Localized;
}

export interface QueueCell {
  election: QueueElection;
  partyId: string;
  partyName: Localized;
  criterionId: string;
  criterionName: Localized;
}

export interface Queue<T> {
  total: number;
  items: T[];
}

export interface Queues {
  drafts: Queue<QueueCell>;
  returned: Queue<QueueCell>;
  review: Queue<QueueCell> | null;
  recheck: Queue<QueueCell> | null;
  changes: Queue<{
    id: string;
    election: QueueElection;
    targetKind: 'election' | 'methodology' | 'party' | 'criterion' | 'methodology_reviewer';
    action: 'update' | 'add' | 'retire';
  }>;
  reports: number | null;
  failedSources: Queue<{ id: string; election: QueueElection; title: string }> | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const getQueues = cache(async (tenant: string): Promise<Queues | undefined> => {
  const body = await readApi(`${tenantPath(tenant)}/queues`);
  if (body === undefined) {
    return undefined;
  }
  if (!isObject(body) || !isObject(body.drafts) || !isObject(body.changes)) {
    throw new Error("The API's answer for the work queues isn't what the admin expects");
  }
  return body as unknown as Queues;
});
