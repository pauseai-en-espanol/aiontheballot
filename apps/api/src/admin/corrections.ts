import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';
import type { Rating } from '@aiontheballot/domain/methodology';
import type { PublicRevision } from '@aiontheballot/domain/public-election';

import { publicHistory } from '@aiontheballot/domain/public-history';
import { sql, type Transaction } from 'kysely';

/**
 * An election's corrections log as the public will see it (editorial workflow H1.4; PLAN R150), read in the member's
 * `withActor` transaction: every published revision after the first its public sees, numbered as its public sees them
 * (what was published while the election was in preview is no correction, `publicHistory`, PLAN R181), and every
 * approved structural change, newest first. The public site builds the same log from its own data.
 */
export type CorrectionEntry =
  | {
      kind: 'revision';
      at: string;
      change: 'update' | 'correction' | 'withdrawal';
      revisionNo: number;
      rating: Rating | null;
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

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

export const listCorrections = async (
  trx: Transaction<DB>,
  election: { id: string; name: Localized },
): Promise<CorrectionEntry[]> => {
  const [revisions, changes, since] = await Promise.all([
    // Every revision, newest first per cell: which are corrections depends on what came before (publicHistory).
    trx
      .selectFrom('app.assessment_revisions as r')
      .innerJoin('app.parties as p', 'p.id', 'r.party_id')
      .innerJoin('app.criteria as c', 'c.id', 'r.criterion_id')
      .select([
        instant('r.published_at').as('at'),
        'r.change_kind',
        'r.revision_no',
        'r.rating',
        'r.public_note',
        'r.published_in_preview',
        'r.assessment_id',
        'p.id as party_id',
        'p.slug as party_slug',
        'p.name as party_name',
        'c.id as criterion_id',
        'c.slug as criterion_slug',
        'c.title as criterion_title',
      ])
      .where('r.election_id', '=', election.id)
      // As the public sees it: a retired party's or criterion's cells are history, not this election's.
      .where('p.retired_at', 'is', null)
      .where('c.retired_at', 'is', null)
      .orderBy('r.assessment_id')
      .orderBy('r.revision_no', 'desc')
      .execute(),
    trx
      .selectFrom('app.structural_changes as s')
      .leftJoin('app.parties as p', 'p.id', 's.target_id')
      .leftJoin('app.criteria as c', 'c.id', 's.target_id')
      .leftJoin('app.methodology_reviewers as m', 'm.id', 's.target_id')
      .select([
        instant('s.approved_at').as('at'),
        's.action',
        's.target_kind',
        's.field',
        's.previous_value',
        's.new_value',
        's.public_note',
        'p.name as party_name',
        'c.title as criterion_title',
        'm.name as reviewer_name',
      ])
      .where('s.election_id', '=', election.id)
      .execute(),
    trx
      .selectFrom('app.elections')
      .select(instant('went_live_at').as('went_live_at'))
      .where('id', '=', election.id)
      .executeTakeFirst(),
  ]);
  // Each cell's history as its public sees it; its corrections are what follow the first.
  const cells = new Map<string, typeof revisions>();
  for (const r of revisions) {
    cells.set(r.assessment_id, [...(cells.get(r.assessment_id) ?? []), r]);
  }
  const corrected = [...cells.values()].flatMap((rows) => {
    const [row] = rows;
    if (!row) {
      return [];
    }
    const history = publicHistory(
      rows.map((r) => ({
        revision: {
          revisionNo: r.revision_no,
          rating: r.rating,
          summary: null,
          changeKind: r.change_kind,
          publicNote: (r.public_note as Localized | null) ?? null,
          publishedAt: r.at,
          evidence: [],
          checkedDocuments: [],
        } satisfies PublicRevision,
        inPreview: r.published_in_preview,
      })),
      { since: since?.went_live_at },
    );
    return history.flatMap((revision): CorrectionEntry[] =>
      revision.changeKind === 'initial'
        ? []
        : [
            {
              kind: 'revision',
              at: revision.publishedAt,
              change: revision.changeKind,
              revisionNo: revision.revisionNo,
              rating: revision.rating,
              party: { id: row.party_id, slug: row.party_slug, name: row.party_name as Localized },
              criterion: {
                id: row.criterion_id,
                slug: row.criterion_slug,
                title: row.criterion_title as Localized,
              },
              publicNote: revision.publicNote,
            },
          ],
    );
  });
  const entries: CorrectionEntry[] = [
    ...corrected,
    ...changes.map((s): CorrectionEntry => ({
      kind: 'structure',
      at: s.at,
      action: s.action,
      targetKind: s.target_kind,
      target:
        s.target_kind === 'election'
          ? election.name
          : ((s.party_name as Localized | null) ??
            (s.criterion_title as Localized | null) ??
            s.reviewer_name ??
            null),
      field: s.field,
      previousValue: s.previous_value,
      newValue: s.new_value,
      publicNote: s.public_note as Localized,
    })),
  ];
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
};
