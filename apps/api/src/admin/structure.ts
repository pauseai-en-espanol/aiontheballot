import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

import type { ChangeResult } from './settings.js';

/**
 * An election's parties and criteria (editorial workflow E4), read and written under RLS: every member reads them;
 * editors, country admins and platform admins write them while the election is a draft. Once it is live they change
 * only through change requests (`change_control`, CR1), and an archived election's are read-only. Structure forms are
 * last-write-wins (W8).
 */

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const optionalLocalized = (value: unknown, column: string): Localized | null =>
  value === null ? null : localized(value, column);

export interface Party {
  id: string;
  slug: string;
  name: Localized;
  shortName: Localized;
  displayOrder: number;
  colour: string | null;
  website: string | null;
  territoryCodes: string[] | null;
  programmeStatus: 'pending' | 'published';
  retired: boolean;
}

export interface PartyFields {
  slug: string;
  name: Localized;
  shortName: Localized;
  colour: string | null;
  website: string | null;
  territoryCodes: string[] | null;
}

export const listParties = async (trx: Transaction<DB>, electionId: string): Promise<Party[]> =>
  (
    await trx
      .selectFrom('app.parties')
      .select([
        'id',
        'slug',
        'name',
        'short_name',
        'display_order',
        'colour',
        'website',
        'territory_codes',
        'programme_status',
        'retired_at',
      ])
      .where('election_id', '=', electionId)
      .orderBy('display_order')
      .orderBy('slug')
      .execute()
  ).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: localized(row.name, 'parties.name'),
    shortName: localized(row.short_name, 'parties.short_name'),
    displayOrder: row.display_order,
    colour: row.colour,
    website: row.website,
    territoryCodes: row.territory_codes,
    programmeStatus: row.programme_status,
    retired: row.retired_at !== null,
  }));

/** The next display order in a list: after the last one. */
const nextOrder = async (
  trx: Transaction<DB>,
  table: 'app.parties' | 'app.criteria',
  electionId: string,
): Promise<number> => {
  const row = await trx
    .selectFrom(table)
    .select((eb) => eb.fn.max<number | null>('display_order').as('last'))
    .where('election_id', '=', electionId)
    .executeTakeFirst();
  return (row?.last ?? 0) + 1;
};

export const createParty = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  fields: PartyFields,
): Promise<{ id: string }> =>
  trx
    .insertInto('app.parties')
    .values({
      tenant_id: tenantId,
      election_id: electionId,
      slug: fields.slug,
      name: JSON.stringify(fields.name),
      short_name: JSON.stringify(fields.shortName),
      colour: fields.colour,
      website: fields.website,
      territory_codes: fields.territoryCodes,
      display_order: await nextOrder(trx, 'app.parties', electionId),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const updateParty = async (
  trx: Transaction<DB>,
  electionId: string,
  partyId: string,
  fields: PartyFields,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.parties')
    .set({
      slug: fields.slug,
      name: JSON.stringify(fields.name),
      short_name: JSON.stringify(fields.shortName),
      colour: fields.colour,
      website: fields.website,
      territory_codes: fields.territoryCodes,
    })
    .where('election_id', '=', electionId)
    .where('id', '=', partyId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : refusalFor(trx, 'app.parties', electionId, partyId);
};

export interface Criterion {
  id: string;
  slug: string;
  title: Localized;
  shortTitle: Localized | null;
  description: Localized;
  displayOrder: number;
  coreCriterionId: string | null;
  retired: boolean;
}

export interface CriterionFields {
  slug: string;
  title: Localized;
  shortTitle: Localized | null;
  description: Localized;
  coreCriterionId: string | null;
}

export const listCriteria = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<Criterion[]> =>
  (
    await trx
      .selectFrom('app.criteria')
      .select([
        'id',
        'slug',
        'title',
        'short_title',
        'description',
        'display_order',
        'core_criterion_id',
        'retired_at',
      ])
      .where('election_id', '=', electionId)
      .orderBy('display_order')
      .orderBy('slug')
      .execute()
  ).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: localized(row.title, 'criteria.title'),
    shortTitle: optionalLocalized(row.short_title, 'criteria.short_title'),
    description: localized(row.description, 'criteria.description'),
    displayOrder: row.display_order,
    coreCriterionId: row.core_criterion_id,
    retired: row.retired_at !== null,
  }));

export const createCriterion = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  fields: CriterionFields,
): Promise<{ id: string }> =>
  trx
    .insertInto('app.criteria')
    .values({
      tenant_id: tenantId,
      election_id: electionId,
      slug: fields.slug,
      title: JSON.stringify(fields.title),
      short_title: fields.shortTitle === null ? null : JSON.stringify(fields.shortTitle),
      description: JSON.stringify(fields.description),
      core_criterion_id: fields.coreCriterionId,
      display_order: await nextOrder(trx, 'app.criteria', electionId),
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const updateCriterion = async (
  trx: Transaction<DB>,
  electionId: string,
  criterionId: string,
  fields: CriterionFields,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.criteria')
    .set({
      slug: fields.slug,
      title: JSON.stringify(fields.title),
      short_title: fields.shortTitle === null ? null : JSON.stringify(fields.shortTitle),
      description: JSON.stringify(fields.description),
      core_criterion_id: fields.coreCriterionId,
    })
    .where('election_id', '=', electionId)
    .where('id', '=', criterionId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : refusalFor(trx, 'app.criteria', electionId, criterionId);
};

/** Deletes a party or criterion of a draft election (E8.1); anything that cites it refuses the delete (E8.2). */
export const deleteFrom = async (
  trx: Transaction<DB>,
  table: 'app.parties' | 'app.criteria',
  electionId: string,
  id: string,
): Promise<ChangeResult> => {
  const deleted = await trx
    .deleteFrom(table)
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return deleted ? 'changed' : refusalFor(trx, table, electionId, id);
};

/**
 * Puts a list in the order given (E4.5), if it is still in the order the page showed (`shown`): otherwise someone
 * changed it meanwhile, and the page reloads (`409 stale`), whether by an addition, a removal or another move. The
 * list's rows are locked first, in one order (by id), and its order read under that lock, so two moves at once run one
 * after the other, the second refused as stale, instead of deadlocking or overwriting the first; only those who may
 * change the structure can lock them (the update policy), which is how anyone else is refused. `NO KEY`, since only
 * the order changes. One statement then numbers the rows from 1, writing only those whose place changed.
 */
export const reorder = async (
  trx: Transaction<DB>,
  table: 'app.parties' | 'app.criteria',
  electionId: string,
  shown: readonly string[],
  ids: readonly string[],
): Promise<ChangeResult> => {
  // The order is read under the lock, so a move that committed while this one waited is seen, and refused as stale.
  const locked = await trx
    .selectFrom(table)
    .select(['id', 'display_order', 'slug'])
    .where('election_id', '=', electionId)
    .orderBy('id')
    .forNoKeyUpdate()
    .execute();
  if (locked.length === 0) {
    // Nothing locked: an empty list, or rows only someone allowed to change them can lock.
    const any = await trx
      .selectFrom(table)
      .select('id')
      .where('election_id', '=', electionId)
      .executeTakeFirst();
    if (any) {
      return 'forbidden';
    }
  }
  const visible = [...locked].sort(
    (a, b) => a.display_order - b.display_order || a.slug.localeCompare(b.slug),
  );
  const current = visible.map((row) => row.id);
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id, index) => id === b[index]);
  if (
    !same(current, shown) ||
    new Set(ids).size !== ids.length ||
    !same([...current].sort(), [...ids].sort())
  ) {
    return 'stale';
  }
  await sql`UPDATE ${sql.table(table)} AS row SET display_order = place.n
              FROM unnest(${[...ids]}::uuid[]) WITH ORDINALITY AS place (id, n)
             WHERE row.election_id = ${electionId} AND row.id = place.id
               AND row.display_order IS DISTINCT FROM place.n`.execute(trx);
  return 'changed';
};

const refusalFor = async (
  trx: Transaction<DB>,
  table: 'app.parties' | 'app.criteria',
  electionId: string,
  id: string,
): Promise<ChangeResult> =>
  (await trx
    .selectFrom(table)
    .select('id')
    .where('election_id', '=', electionId)
    .where('id', '=', id)
    .executeTakeFirst())
    ? 'forbidden'
    : 'not-found';

/** The platform's core criteria, for a criterion to point at (members read them all). */
export const listCoreCriteria = async (trx: Transaction<DB>) =>
  (
    await trx
      .selectFrom('app.core_criteria')
      .select(['id', 'key', 'title'])
      .orderBy('key')
      .execute()
  ).map((row) => ({
    id: row.id,
    key: row.key,
    title: localized(row.title, 'core_criteria.title'),
  }));
