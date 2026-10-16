import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

/**
 * Change requests (editorial workflow CR1; migration `change_control`): once an election is live, its public structure
 * changes only through one. Editors and country admins propose; reviewers, country admins and platform admins decide;
 * approving applies the change as the approver, in the same transaction, and writes its public record. Everything here
 * runs in the caller's `withActor` transaction: RLS and the change rules decide (the previous value is read from the
 * target by the database, never taken from the client), and this module only reads and writes rows.
 */

export const CHANGE_TARGETS = [
  'election',
  'methodology',
  'methodology_reviewer',
  'party',
  'criterion',
] as const;
export type ChangeTarget = (typeof CHANGE_TARGETS)[number];

export const CHANGE_ACTIONS = ['update', 'add', 'retire'] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export type ChangeState = 'pending' | 'approved' | 'rejected';

/**
 * What a change request may set on each target, as the database's change rules have them: the fields an update may
 * change, and the columns of a new row (none: elections and methodologies are never added or retired). The database
 * checks again; the API refuses anything else before writing.
 */
export const CHANGEABLE: Readonly<
  Record<ChangeTarget, { update: readonly string[]; add: readonly string[] | null }>
> = {
  election: { update: ['name', 'election_date'], add: null },
  methodology: {
    update: ['demands_owner_id', 'body', 'admissible_source_kinds', 'not_mentioned_source_kinds'],
    add: null,
  },
  methodology_reviewer: {
    update: ['name', 'affiliation', 'display_order'],
    add: ['name', 'affiliation', 'display_order'],
  },
  party: {
    update: [
      'name',
      'short_name',
      'logo_file_id',
      'colour',
      'display_order',
      'website',
      'territory_codes',
    ],
    add: [
      'slug',
      'name',
      'short_name',
      'logo_file_id',
      'colour',
      'display_order',
      'website',
      'territory_codes',
    ],
  },
  criterion: {
    update: ['title', 'short_title', 'description', 'display_order', 'core_criterion_id'],
    add: ['slug', 'title', 'short_title', 'description', 'display_order', 'core_criterion_id'],
  },
};

export interface ChangeRequest {
  id: string;
  action: ChangeAction;
  targetKind: ChangeTarget;
  targetId: string | null;
  field: string | null;
  /** The value when it was proposed, read by the database from the target; for an update only. */
  previousValue: unknown;
  /** The new value (an update), or the new row's columns (an addition); null for a retirement. */
  proposedValue: unknown;
  publicNote: Localized;
  state: ChangeState;
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  /** What it changes, in words: a party's or reviewer's name, a criterion's title; null for the election itself. */
  targetName: Localized | string | null;
}

export interface Proposal {
  action: ChangeAction;
  targetKind: ChangeTarget;
  targetId: string | null;
  field: string | null;
  /** Undefined for a retirement. */
  value?: unknown;
  publicNote: Localized;
  /** The right-of-reply report that prompted it (CR1.8). */
  reportId?: string | null;
}

const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

const nameOf = (value: unknown): Localized | string | null =>
  isLocalized(value) ? value : typeof value === 'string' ? value : null;

/** Every change request of the election RLS shows the actor, pending first, then the newest. */
export const listChanges = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<ChangeRequest[]> => {
  const rows = await trx
    .selectFrom('app.change_requests as r')
    .leftJoin('app.parties as p', (join) =>
      join.onRef('p.id', '=', 'r.target_id').on('r.target_kind', '=', 'party'),
    )
    .leftJoin('app.criteria as c', (join) =>
      join.onRef('c.id', '=', 'r.target_id').on('r.target_kind', '=', 'criterion'),
    )
    .leftJoin('app.methodology_reviewers as m', (join) =>
      join.onRef('m.id', '=', 'r.target_id').on('r.target_kind', '=', 'methodology_reviewer'),
    )
    .select([
      'r.id',
      'r.action',
      'r.target_kind',
      'r.target_id',
      'r.field',
      'r.previous_value',
      'r.proposed_value',
      'r.public_note',
      'r.state',
      'r.proposed_by',
      instant('r.proposed_at').as('proposed_at'),
      'r.decided_by',
      sql<string | null>`to_json(r.decided_at)#>>'{}'`.as('decided_at'),
      'p.name as party_name',
      'c.title as criterion_title',
      'm.name as reviewer_name',
    ])
    .where('r.election_id', '=', electionId)
    .orderBy(sql`r.state = 'pending'`, 'desc')
    .orderBy('r.proposed_at', 'desc')
    .execute();
  return rows.map((row) => {
    const proposed = row.proposed_value as Record<string, unknown> | null;
    const added = row.action === 'add' && proposed && typeof proposed === 'object' ? proposed : {};
    return {
      id: row.id,
      action: row.action,
      targetKind: row.target_kind as ChangeTarget,
      targetId: row.target_id,
      field: row.field,
      previousValue: row.previous_value,
      proposedValue: row.proposed_value,
      publicNote: row.public_note as Localized,
      state: row.state,
      proposedBy: row.proposed_by,
      proposedAt: row.proposed_at,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at,
      targetName:
        nameOf(row.party_name) ??
        nameOf(row.criterion_title) ??
        nameOf(row.reviewer_name) ??
        nameOf(added.name) ??
        nameOf(added.title),
    };
  });
};

/** A new change request (CR1.1–3); its id. The database reads the previous value and normalizes the new one. */
export const proposeChange = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  proposal: Proposal,
): Promise<string> => {
  const value = proposal.value === undefined ? null : JSON.stringify(proposal.value);
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                     public_note, report_id)
    VALUES (${tenantId}, ${electionId}, ${proposal.action}, ${proposal.targetKind}, ${proposal.targetId},
            ${proposal.field}, ${value}::jsonb, ${JSON.stringify(proposal.publicNote)}::jsonb,
            ${proposal.reportId ?? null})
    RETURNING id`.execute(trx);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('The new change request came back with no id');
  }
  return id;
};

/**
 * Decides a pending request (CR1.4–6): approving applies it, as the approver, in this transaction. Undefined if the
 * election has no such request; 'decided' if it was decided already.
 */
export const decideChange = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
  state: 'approved' | 'rejected',
): Promise<'changed' | 'decided' | undefined> => {
  const found = await trx
    .selectFrom('app.change_requests')
    .select('state')
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!found) {
    return undefined;
  }
  if (found.state !== 'pending') {
    return 'decided';
  }
  const updated = await trx
    .updateTable('app.change_requests')
    .set({ state })
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .executeTakeFirst();
  // Read but not updated: RLS gives deciding to reviewers, country admins and platform admins only.
  return updated.numUpdatedRows > 0n ? 'changed' : undefined;
};

/** Withdraws a pending request (CR1.7): editors and country admins; a decided one never changes. */
export const withdrawChange = async (
  trx: Transaction<DB>,
  electionId: string,
  id: string,
): Promise<boolean> =>
  (
    await trx
      .deleteFrom('app.change_requests')
      .where('election_id', '=', electionId)
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .executeTakeFirst()
  ).numDeletedRows > 0n;

/**
 * Where a new party, criterion or reviewer goes in its list: last, as one added to a draft does (E4), after the
 * additions still waiting for a decision too, so two proposed one after the other keep that order. Two proposed at the
 * same moment may share a place; every list then orders them by slug (reviewers by name).
 */
export const nextDisplayOrder = async (
  trx: Transaction<DB>,
  electionId: string,
  targetKind: 'party' | 'criterion' | 'methodology_reviewer',
): Promise<number> => {
  const { rows } = await sql<{ next: number }>`
    SELECT greatest(
             (${
               targetKind === 'methodology_reviewer'
                 ? sql`SELECT max(r.display_order) FROM app.methodology_reviewers r
                         JOIN app.methodologies m ON m.id = r.methodology_id
                        WHERE m.election_id = ${electionId}`
                 : sql`SELECT max(display_order)
                         FROM ${sql.table(targetKind === 'party' ? 'app.parties' : 'app.criteria')}
                        WHERE election_id = ${electionId}`
             }),
             (SELECT max((proposed_value ->> 'display_order')::int) FROM app.change_requests
               WHERE election_id = ${electionId} AND target_kind = ${targetKind} AND action = 'add'
                 AND state = 'pending'),
             0) + 1 AS next`.execute(trx);
  return Number(rows[0]?.next ?? 1);
};
