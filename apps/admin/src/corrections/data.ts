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
      id: string;
      at: string;
      /** Whether it was taken out of the public log (PLAN R248): shown here, marked, and nowhere in public. */
      removed: boolean;
      /** Whether a country admin or platform admin may take it out: a later change replaced it. */
      replaced: boolean;
      action: 'update' | 'add' | 'retire';
      targetKind: string;
      target: Localized | string | null;
      field: string | null;
      previousValue: unknown;
      newValue: unknown;
      publicNote: Localized;
    };

export interface Corrections {
  entries: CorrectionEntry[];
  /** Whether the member may take an entry out of the public log, or put it back. */
  canRemove: boolean;
}

export const getCorrections = cache(
  async (tenant: string, election: string): Promise<Corrections | undefined> => {
    const body = await readApi(
      `${tenantPath(tenant)}/e/${encodeURIComponent(election)}/corrections`,
    );
    if (body === undefined) {
      return undefined;
    }
    const { entries, canRemove } = body as { entries?: unknown; canRemove?: unknown };
    if (!Array.isArray(entries)) {
      throw new Error('The API answered something other than a corrections log');
    }
    return { entries: entries as CorrectionEntry[], canRemove: canRemove === true };
  },
);
