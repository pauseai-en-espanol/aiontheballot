import type { Database } from '@aiontheballot/db/client';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { isRating, type Rating } from '@aiontheballot/domain/methodology';
import { sql } from 'kysely';

/**
 * The cell grid of an election (editorial workflow C1.1): parties down the side, criteria across the top, as in the
 * public table, and in each cell its working state, its published rating and its flags. Read in the caller's
 * `withActor` transaction, so RLS decides: a member sees their own tenants' elections, a platform admin every
 * tenant's, anyone else nothing (undefined, which the route answers with 404).
 */

/** A cell's working state: none yet, a first draft, in review, published, or published with a newer draft. */
export type WorkingState = 'none' | 'draft' | 'in_review' | 'published' | 'published_with_draft';

export interface GridCell {
  partyId: string;
  criterionId: string;
  /** The cell's id, once it exists. */
  assessmentId: string | null;
  working: WorkingState;
  /** What the public sees: the latest revision's rating, null when it withdrew the rating; none before publishing. */
  published: { rating: Rating | null; revisionNo: number } | null;
  /** Sent back to draft by a reviewer, with a note the editors should read. */
  rejected: boolean;
  /** Flagged to check again, e.g. because the party's programme appeared (C12). */
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
  /** Every party × criterion pair, parties first, in display order. */
  cells: GridCell[];
}

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

export const cellGrid = async (
  trx: Database,
  tenantSlug: string,
  electionSlug: string,
): Promise<CellGrid | undefined> => {
  const election = await trx
    .selectFrom('app.elections as e')
    .innerJoin('app.tenants as t', 't.id', 'e.tenant_id')
    .select(['e.id', 'e.slug', 'e.name', 'e.status'])
    .where('t.slug', '=', tenantSlug)
    .where('e.slug', '=', electionSlug)
    .executeTakeFirst();
  if (!election) {
    return undefined;
  }
  const [parties, criteria, assessments, revisions, lastEvents] = await Promise.all([
    trx
      .selectFrom('app.parties')
      .select(['id', 'slug', 'name', 'short_name', 'retired_at'])
      .where('election_id', '=', election.id)
      .orderBy('display_order')
      .orderBy('slug')
      .execute(),
    trx
      .selectFrom('app.criteria')
      .select(['id', 'slug', 'title', 'short_title', 'retired_at'])
      .where('election_id', '=', election.id)
      .orderBy('display_order')
      .orderBy('slug')
      .execute(),
    trx
      .selectFrom('app.assessments')
      .select(['id', 'party_id', 'criterion_id', 'state', 'recheck_reason'])
      .where('election_id', '=', election.id)
      .execute(),
    trx
      .selectFrom('app.current_revisions')
      .select(['assessment_id', 'rating', 'revision_no'])
      .where('election_id', '=', election.id)
      .execute(),
    // Each cell's latest review event: a rejection still stands while the cell is a draft.
    trx
      .selectFrom('app.review_events as r')
      .innerJoin('app.assessments as a', 'a.id', 'r.assessment_id')
      .select(['r.assessment_id', 'r.kind'])
      .where('a.election_id', '=', election.id)
      .distinctOn('r.assessment_id')
      .orderBy('r.assessment_id')
      .orderBy('r.created_at', 'desc')
      .orderBy(sql`r.id`, 'desc')
      .execute(),
  ]);
  const byPair = new Map(assessments.map((a) => [`${a.party_id}/${a.criterion_id}`, a]));
  const revisionOf = new Map(revisions.map((r) => [r.assessment_id, r]));
  const lastEventOf = new Map(lastEvents.map((e) => [e.assessment_id, e.kind]));
  const cells = parties.flatMap((party) =>
    criteria.map((criterion): GridCell => {
      const cell = byPair.get(`${party.id}/${criterion.id}`);
      const revision = cell && revisionOf.get(cell.id);
      const working: WorkingState = !cell
        ? 'none'
        : cell.state === 'draft' && revision
          ? 'published_with_draft'
          : cell.state;
      return {
        partyId: party.id,
        criterionId: criterion.id,
        assessmentId: cell?.id ?? null,
        working,
        published:
          revision && revision.revision_no !== null
            ? {
                rating: isRating(revision.rating) ? revision.rating : null,
                revisionNo: revision.revision_no,
              }
            : null,
        // A rejection returns the cell to draft, and resubmitting records a newer event.
        rejected: cell !== undefined && lastEventOf.get(cell.id) === 'rejected',
        recheck: cell?.recheck_reason !== null && cell?.recheck_reason !== undefined,
      };
    }),
  );
  return {
    election: {
      id: election.id,
      slug: election.slug,
      name: localized(election.name, 'elections.name'),
      status: election.status,
    },
    parties: parties.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: localized(p.name, 'parties.name'),
      shortName: localized(p.short_name, 'parties.short_name'),
      retired: p.retired_at !== null,
    })),
    criteria: criteria.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: localized(c.title, 'criteria.title'),
      shortTitle: c.short_title === null ? null : localized(c.short_title, 'criteria.short_title'),
      retired: c.retired_at !== null,
    })),
    cells,
  };
};
