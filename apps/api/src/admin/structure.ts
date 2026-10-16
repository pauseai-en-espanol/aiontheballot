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
  /** When someone last checked (editorial workflow PS1), an ISO 8601 instant; null if never. */
  programmeCheckedAt: string | null;
  /** Whether a source of the party is marked as its programme, which "published" needs (PLAN R30). */
  hasProgrammeSource: boolean;
  /** Its logo's file and bytes, by hash, in the site's public assets (PLAN R142); null without one. */
  logo: { id: string; sha256: string; contentType: string } | null;
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
      .leftJoin('app.files as logo', 'logo.id', 'app.parties.logo_file_id')
      .select([
        'app.parties.id',
        'slug',
        'name',
        'short_name',
        'display_order',
        'colour',
        'website',
        'territory_codes',
        'logo.id as logo_id',
        'logo.sha256 as logo_sha256',
        'logo.content_type as logo_content_type',
        'programme_status',
        sql<string | null>`to_json(programme_checked_at)#>>'{}'`.as('programme_checked_at'),
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom('app.source_documents as s')
                .select('s.id')
                .whereRef('s.party_id', '=', 'app.parties.id')
                .where('s.is_programme', '=', true),
            )
            .as('has_programme_source'),
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
    programmeCheckedAt: row.programme_checked_at,
    hasProgrammeSource: row.has_programme_source === true,
    logo:
      row.logo_id && row.logo_sha256 && row.logo_content_type
        ? { id: row.logo_id, sha256: row.logo_sha256, contentType: row.logo_content_type }
        : null,
    retired: row.retired_at !== null,
  }));

/**
 * Records a check of a party's programme (editorial workflow PS1): sets its status, even to the same value, which the
 * database stamps with the check's date. "Published" needs a source marked as the party's programme; an archived
 * election or a freeze window refuses it (the database decides, and audits it).
 */
export const setProgrammeStatus = async (
  trx: Transaction<DB>,
  electionId: string,
  partyId: string,
  status: 'pending' | 'published',
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.parties')
    .set({ programme_status: status })
    .where('election_id', '=', electionId)
    .where('id', '=', partyId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : refusalFor(trx, 'app.parties', electionId, partyId);
};

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

/** Whether a party exists in the election, what its logo is now and whether it was retired: before an upload is read. */
export const partyForLogo = async (
  trx: Transaction<DB>,
  electionId: string,
  partyId: string,
): Promise<{ logoFileId: string | null; retired: boolean } | undefined> => {
  const row = await trx
    .selectFrom('app.parties')
    .select(['logo_file_id', 'retired_at'])
    .where('election_id', '=', electionId)
    .where('id', '=', partyId)
    .executeTakeFirst();
  return row ? { logoFileId: row.logo_file_id, retired: row.retired_at !== null } : undefined;
};

/** One of the site's public images (a logo, named or only proposed) by its file's id, for members to see it. */
export const publicImageFile = async (
  trx: Transaction<DB>,
  tenantId: string,
  fileId: string,
): Promise<{ tenantId: string; sha256: string; contentType: string } | undefined> => {
  const row = await trx
    .selectFrom('app.files')
    .select(['tenant_id', 'sha256', 'content_type'])
    .where('tenant_id', '=', tenantId)
    .where('bucket', '=', 'public_assets')
    .where('id', '=', fileId)
    .executeTakeFirst();
  return row
    ? { tenantId: row.tenant_id, sha256: row.sha256, contentType: row.content_type }
    : undefined;
};

/** A party's logo, with where its bytes are (the site's public assets), for members to see it. */
export const partyLogoFile = async (
  trx: Transaction<DB>,
  electionId: string,
  partyId: string,
): Promise<{ tenantId: string; sha256: string; contentType: string } | undefined> => {
  const row = await trx
    .selectFrom('app.parties as p')
    .innerJoin('app.files as f', 'f.id', 'p.logo_file_id')
    .select(['f.tenant_id', 'f.sha256', 'f.content_type'])
    .where('p.election_id', '=', electionId)
    .where('p.id', '=', partyId)
    .executeTakeFirst();
  return row
    ? { tenantId: row.tenant_id, sha256: row.sha256, contentType: row.content_type }
    : undefined;
};

/**
 * Deletes a file row nothing names any more (a replaced logo), so the sweep can remove its bytes in time (ADR-0004 §5).
 * One still named, by any row (another party's logo, a brand selection, even one RLS hides from the actor), stays: the
 * foreign key refuses the delete, which a savepoint keeps from undoing the rest of the transaction.
 */
export const dropFileIfUnnamed = async (trx: Transaction<DB>, fileId: string): Promise<void> => {
  // A pending change request may name it as a live party's next logo (jsonb, so no foreign key says so).
  const proposed = await sql<{ id: string }>`
    SELECT id FROM app.change_requests
     WHERE state = 'pending'
       AND (proposed_value = to_jsonb(${fileId}::text) OR proposed_value ->> 'logo_file_id' = ${fileId})
     LIMIT 1`.execute(trx);
  if (proposed.rows.length > 0) {
    return;
  }
  await sql`SAVEPOINT drop_file`.execute(trx);
  try {
    await trx.deleteFrom('app.files').where('id', '=', fileId).execute();
    await sql`RELEASE SAVEPOINT drop_file`.execute(trx);
  } catch (error) {
    if ((error as { code?: unknown }).code !== '23503') {
      throw error;
    }
    await sql`ROLLBACK TO SAVEPOINT drop_file`.execute(trx);
  }
};

/** A logo's bytes, which the caller stored first in the site's public assets, and what they are. */
export interface LogoUpload {
  sha256: string;
  byteSize: number;
  contentType: string;
  filename: string | null;
}

/**
 * The site's file row for a logo's bytes: the one it has for the same bytes if any (the same bytes are one file), else
 * a new one; undefined if those bytes are already a file of another type. Nothing names it yet: it is public only once
 * a party of a public election does (RLS, `public_read`).
 */
export const storeLogoFile = async (
  trx: Transaction<DB>,
  tenantId: string,
  upload: LogoUpload,
): Promise<string | undefined> => {
  const existing = await trx
    .selectFrom('app.files')
    .select(['id', 'content_type'])
    .where('tenant_id', '=', tenantId)
    .where('bucket', '=', 'public_assets')
    .where('sha256', '=', upload.sha256)
    .executeTakeFirst();
  if (existing) {
    return existing.content_type === upload.contentType ? existing.id : undefined;
  }
  // Two parties given the same new bytes at once: the second finds the first's row rather than failing on it.
  const { rows } = await sql<{ id: string }>`
    INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
    VALUES (${tenantId}, 'public_assets', ${upload.contentType}, ${upload.byteSize}, ${upload.sha256},
            ${upload.filename})
    ON CONFLICT (tenant_id, bucket, sha256) DO NOTHING
    RETURNING id`.execute(trx);
  const id =
    rows[0]?.id ??
    (
      await trx
        .selectFrom('app.files')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('bucket', '=', 'public_assets')
        .where('sha256', '=', upload.sha256)
        .executeTakeFirst()
    )?.id;
  if (!id) {
    throw new Error("The logo's file row came back with no id");
  }
  return id;
};

/**
 * Sets or removes a party's logo (editorial workflow E4; PLAN R142), whose bytes the caller stored first in the site's
 * public assets (`storeLogoFile`); then the party names it, and the logo it named before is deleted if nothing else
 * names it. The party is locked first, so two changes at once run one after the other. While the election is a draft
 * or in preview only: once it is live, a logo changes through a change request (CR1), which the database enforces
 * (`change_control`).
 */
export const setPartyLogo = async (
  trx: Transaction<DB>,
  tenantId: string,
  electionId: string,
  partyId: string,
  upload: LogoUpload | null,
): Promise<'changed' | 'notFound' | 'otherType'> => {
  const party = await trx
    .selectFrom('app.parties')
    .select('logo_file_id')
    .where('election_id', '=', electionId)
    .where('id', '=', partyId)
    .forUpdate()
    .executeTakeFirst();
  if (!party) {
    return 'notFound';
  }
  let fileId: string | null = null;
  if (upload) {
    const stored = await storeLogoFile(trx, tenantId, upload);
    if (!stored) {
      return 'otherType';
    }
    fileId = stored;
  }
  await trx
    .updateTable('app.parties')
    .set({ logo_file_id: fileId })
    .where('election_id', '=', electionId)
    .where('id', '=', partyId)
    .execute();
  if (party.logo_file_id && party.logo_file_id !== fileId) {
    await dropFileIfUnnamed(trx, party.logo_file_id);
  }
  return 'changed';
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
