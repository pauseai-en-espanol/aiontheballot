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
 * approved structural change, newest first. The public site builds the same log from its own data. A structural change
 * taken out of the log (PLAN R248) is listed too, marked, so it can be put back; the public reads nothing of it.
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
      /** Its public record's id, which a removal from the log names (PLAN R248). */
      id: string;
      at: string;
      /** Whether it was taken out of the log: members still see it here, marked; the public doesn't. */
      removed: boolean;
      /** Whether it may be: an update whose every field a later one changed again. */
      replaced: boolean;
      action: 'update' | 'add' | 'retire';
      targetKind: string;
      target: Localized | string | null;
      field: string | null;
      previousValue: unknown;
      newValue: unknown;
      publicNote: Localized;
    };

/** The fields an update changed: its one field, or each of a set's (PLAN R183). */
export const changedFields = (field: string | null, newValue: unknown): string[] =>
  field !== null
    ? [field]
    : typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)
      ? Object.keys(newValue)
      : [];

/**
 * Which of an election's structural changes, newest first, may be taken out of its log (PLAN R248): the updates whose
 * every field was changed again by a later update of the same target, so the log always holds the change in force. It
 * only says what the page offers: the database decides (`private.log_removal_rules`).
 */
export const replacedChanges = (
  changes: readonly {
    id: string;
    action: 'update' | 'add' | 'retire';
    target: string;
    fields: readonly string[];
  }[],
): Set<string> => {
  const later = new Map<string, Set<string>>();
  const replaced = new Set<string>();
  for (const change of changes) {
    if (change.action !== 'update') {
      continue;
    }
    const fields = later.get(change.target) ?? new Set<string>();
    if (change.fields.every((field) => fields.has(field))) {
      replaced.add(change.id);
    }
    later.set(change.target, new Set([...fields, ...change.fields]));
  }
  return replaced;
};

/**
 * Takes an election's structural change out of its public log (PLAN R248), or puts it back. The database refuses anyone
 * but the site's country admins and platform admins, a change still in force, and anything inside a freeze window.
 * False if the election has no such change in the log (to take out) or out of it (to put back).
 */
export const setInLog = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  changeId: string,
  inLog: boolean,
): Promise<boolean> => {
  if (inLog) {
    const deleted = await trx
      .deleteFrom('app.log_removals')
      .where('tenant_id', '=', tenantId)
      .where('election_id', '=', electionId)
      .where('structural_change_id', '=', changeId)
      .executeTakeFirst();
    return deleted.numDeletedRows > 0n;
  }
  const change = await trx
    .selectFrom('app.structural_changes as s')
    .select('s.id')
    .where('s.tenant_id', '=', tenantId)
    .where('s.election_id', '=', electionId)
    .where('s.id', '=', changeId)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('app.log_removals as x')
            .select('x.id')
            .whereRef('x.structural_change_id', '=', 's.id'),
        ),
      ),
    )
    .executeTakeFirst();
  if (!change) {
    return false;
  }
  await sql`INSERT INTO app.log_removals (tenant_id, structural_change_id)
            VALUES (${tenantId}, ${changeId})`.execute(trx);
  return true;
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
        'r.unlogged',
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
      .leftJoin('app.log_removals as x', (join) =>
        join.onRef('x.structural_change_id', '=', 's.id').onRef('x.tenant_id', '=', 's.tenant_id'),
      )
      .select([
        's.id',
        instant('s.approved_at').as('at'),
        'x.id as removal_id',
        's.action',
        's.target_kind',
        's.target_id',
        's.field',
        's.previous_value',
        's.new_value',
        's.public_note',
        'p.name as party_name',
        'c.title as criterion_title',
        'm.name as reviewer_name',
      ])
      .where('s.election_id', '=', election.id)
      .orderBy('s.approved_at', 'desc')
      .orderBy('s.id', 'desc')
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
        unlogged: r.unlogged,
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
  const replaced = replacedChanges(
    changes.map((s) => ({
      id: s.id,
      action: s.action,
      target: `${s.target_kind} ${s.target_id}`,
      fields: changedFields(s.field, s.new_value),
    })),
  );
  const entries: CorrectionEntry[] = [
    ...corrected,
    ...changes.map((s): CorrectionEntry => ({
      kind: 'structure',
      id: s.id,
      at: s.at,
      removed: s.removal_id !== null,
      replaced: replaced.has(s.id),
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
