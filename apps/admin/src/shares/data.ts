import { cache } from 'react';

import { readApi, tenantPath } from '@/data';

/** How an election's pages are shared (PLAN R239), as the API counts them: counts only. */
export type ShareEvent = 'share' | 'arrival' | 'preview';

export interface ElectionShares {
  since: string | null;
  totals: Record<ShareEvent, number>;
  channels: { event: ShareEvent; channel: string; count: number }[];
  pages: ({ path: string } & Record<ShareEvent, number>)[];
  days: ({ day: string } & Record<ShareEvent, number>)[];
}

export const getShares = cache(
  async (tenant: string, election: string): Promise<ElectionShares | undefined> => {
    const body = await readApi(`${tenantPath(tenant)}/e/${encodeURIComponent(election)}/shares`);
    return body === undefined ? undefined : (body as ElectionShares);
  },
);
