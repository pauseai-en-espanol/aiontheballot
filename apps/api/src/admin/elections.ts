import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

import type { ChangeResult } from './settings.js';

export const ELECTION_TYPES = ['general', 'european', 'regional', 'municipal', 'other'] as const;
export type ElectionStatus = 'draft' | 'preview' | 'live' | 'archived';

/**
 * Whether an election's structure is edited directly (PLAN R181): a draft's, and one in preview's, which the public
 * hasn't seen. Once live, it changes through change requests (CR1).
 */
export const editedDirectly = (status: ElectionStatus): boolean =>
  status === 'draft' || status === 'preview';
export type ElectionType = (typeof ELECTION_TYPES)[number];

export interface ElectionSummary {
  id: string;
  slug: string;
  name: Localized;
  type: ElectionType;
  territoryCode: string | null;
  /** The day, as `YYYY-MM-DD`, or null while unknown. */
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

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

/** The columns every election read takes; the date as text, since node-postgres would read a date in local time. */
const electionColumns = (trx: Transaction<DB>) =>
  trx
    .selectFrom('app.elections as e')
    .select([
      'e.id',
      'e.slug',
      'e.name',
      'e.type',
      'e.territory_code',
      sql<string | null>`e.election_date::text`.as('election_date'),
      'e.status',
      'e.announced',
    ]);

type ElectionRow = {
  id: string;
  slug: string;
  name: unknown;
  type: ElectionType;
  territory_code: string | null;
  election_date: string | null;
  status: ElectionStatus;
  announced: boolean;
};

const summary = (row: ElectionRow): ElectionSummary => ({
  id: row.id,
  slug: row.slug,
  name: localized(row.name, 'elections.name'),
  type: row.type,
  territoryCode: row.territory_code,
  date: row.election_date,
  status: row.status,
  announced: row.announced,
});

/** The tenant's elections (editorial workflow §6), soonest first, those without a date last. Every member reads them. */
export const listElections = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<ElectionSummary[]> =>
  (
    await electionColumns(trx)
      .where('e.tenant_id', '=', tenantId)
      .orderBy(sql`e.election_date`, sql`asc nulls last`)
      .orderBy('e.created_at')
      .execute()
  ).map(summary);

/** An election of the tenant by its slug, with what its overview shows, or undefined. */
export const getElection = async (
  trx: Transaction<DB>,
  tenantId: string,
  slug: string,
): Promise<Election | undefined> => {
  const row = await electionColumns(trx)
    .select([
      'e.require_second_reviewer',
      'e.frozen_from',
      'e.frozen_until',
      'e.went_live_at',
      (eb) =>
        eb
          .selectFrom('app.parties as p')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('p.election_id', '=', 'e.id')
          .as('parties'),
      (eb) =>
        eb
          .selectFrom('app.criteria as c')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('c.election_id', '=', 'e.id')
          .as('criteria'),
      (eb) =>
        eb
          .selectFrom('app.methodology_reviewers as r')
          .innerJoin('app.methodologies as m', 'm.id', 'r.methodology_id')
          .select(eb.fn.countAll<string>().as('n'))
          .whereRef('m.election_id', '=', 'e.id')
          .as('reviewers'),
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('app.methodologies as m')
              .select('m.id')
              .whereRef('m.election_id', '=', 'e.id'),
          )
          .as('has_methodology'),
    ])
    .where('e.tenant_id', '=', tenantId)
    .where('e.slug', '=', slug)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return {
    ...summary(row),
    requireSecondReviewer: row.require_second_reviewer,
    frozenFrom: row.frozen_from?.toISOString() ?? null,
    frozenUntil: row.frozen_until?.toISOString() ?? null,
    wentLiveAt: row.went_live_at?.toISOString() ?? null,
    counts: {
      parties: Number(row.parties ?? 0),
      criteria: Number(row.criteria ?? 0),
      reviewers: Number(row.reviewers ?? 0),
    },
    hasMethodology: row.has_methodology === true,
  };
};

export interface ElectionFields {
  slug: string;
  type: ElectionType;
  territoryCode: string | null;
  name: Localized;
  date: string | null;
}

/**
 * Creates an election (editorial workflow E1.1): editors, country admins and platform admins may (RLS), and the
 * column grants make it a draft, unannounced, with four-eyes on and no freeze window, whatever is sent. The checks and
 * `election_rules` refuse a locale-shaped or reserved slug, a territory the type doesn't allow, or one outside the
 * tenant's country (E1.2).
 */
export const createElection = async (
  trx: Transaction<DB>,
  tenantId: string,
  fields: ElectionFields,
): Promise<{ id: string; slug: string }> =>
  trx
    .insertInto('app.elections')
    .values({
      tenant_id: tenantId,
      slug: fields.slug,
      type: fields.type,
      territory_code: fields.territoryCode,
      name: JSON.stringify(fields.name),
      election_date: fields.date,
    })
    .returning(['id', 'slug'])
    .executeTakeFirstOrThrow();

export interface ElectionChange extends Partial<ElectionFields> {
  /** Country admins, while a draft (R51). */
  announced?: boolean;
  /** Platform admins only (P1). */
  requireSecondReviewer?: boolean;
  /** Country admins: into preview (PLAN R181), going live (E5) or archiving (E7), never back. */
  status?: 'preview' | 'live' | 'archived';
  /** Country admins: the freeze window (E6), as instants; until none means until cleared. */
  frozenFrom?: string | null;
  frozenUntil?: string | null;
}

/**
 * Changes an election (E1.3, E5–E7, P1). The database decides: editors and country admins write the fields while it is
 * a draft (`election_rules` fixes the slug, type and territory once live, and change control the name and date);
 * country admins the announcement, the status (draft to preview or live, preview to live, each once everything public
 * has its default-language text, then archived) and the freeze window; platform admins four-eyes; all audited.
 */
export const updateElection = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  change: ElectionChange,
): Promise<ChangeResult> => {
  const values = {
    ...(change.slug === undefined ? {} : { slug: change.slug }),
    ...(change.type === undefined ? {} : { type: change.type }),
    ...(change.territoryCode === undefined ? {} : { territory_code: change.territoryCode }),
    ...(change.name === undefined ? {} : { name: JSON.stringify(change.name) }),
    ...(change.date === undefined ? {} : { election_date: change.date }),
    ...(change.announced === undefined ? {} : { announced: change.announced }),
    ...(change.requireSecondReviewer === undefined
      ? {}
      : { require_second_reviewer: change.requireSecondReviewer }),
    ...(change.status === undefined ? {} : { status: change.status }),
    ...(change.frozenFrom === undefined ? {} : { frozen_from: change.frozenFrom }),
    ...(change.frozenUntil === undefined ? {} : { frozen_until: change.frozenUntil }),
  };
  const updated = await trx
    .updateTable('app.elections')
    .set(values)
    .where('tenant_id', '=', tenantId)
    .where('id', '=', electionId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : 'forbidden';
};

/**
 * Deletes a draft election (E8.1): country admins and platform admins, while it is a draft (RLS). Anything that still
 * references it refuses the delete (a foreign key, `409 linked`), so its structure goes first (E8.2).
 */
export const deleteElection = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
): Promise<ChangeResult> => {
  const deleted = await trx
    .deleteFrom('app.elections')
    .where('tenant_id', '=', tenantId)
    .where('id', '=', electionId)
    .returning('id')
    .executeTakeFirst();
  return deleted ? 'changed' : 'forbidden';
};
