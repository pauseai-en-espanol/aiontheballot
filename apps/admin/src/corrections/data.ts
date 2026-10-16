import { cache } from 'react';

import type { Localized } from '@/data';

import { readApi, tenantPath } from '@/data';

/** An election's corrections log as the public will see it (editorial workflow H1.4; PLAN R150). */
export type CorrectionEntry =
  | {
      kind: 'revision';
      at: string;
      change: 'update' | 'correction' | 'withdrawal';
      revisionNo: number;
      rating: string | null;
      party: { id: string; slug: string; name: Localized };
      criterion: { id: string; slug: string; title: Localized };
      publicNote: Localized | null;
    }
  | {
      kind: 'structure';
      at: string;
      action: 'update' | 'add' | 'retire';
      targetKind: string;
      target: Localized | string | null;
      field: string | null;
      previousValue: unknown;
      newValue: unknown;
      publicNote: Localized;
    };

export const getCorrections = cache(
  async (tenant: string, election: string): Promise<CorrectionEntry[] | undefined> => {
    const body = await readApi(
      `${tenantPath(tenant)}/e/${encodeURIComponent(election)}/corrections`,
    );
    if (body === undefined) {
      return undefined;
    }
    const entries = (body as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) {
      throw new Error('The API answered something other than a corrections log');
    }
    return entries as CorrectionEntry[];
  },
);
