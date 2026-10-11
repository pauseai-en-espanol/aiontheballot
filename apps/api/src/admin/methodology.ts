import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

import type { ChangeResult } from './settings.js';

/** The kinds of source a methodology may admit, as `app.source_kind` has them. */
export const SOURCE_KINDS = [
  'pdf',
  'web_page',
  'social_post',
  'video',
  'audio',
  'party_submission',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Reviewer {
  id: string;
  name: string;
  affiliation: string;
  displayOrder: number;
  retired: boolean;
}

export interface Methodology {
  id: string;
  kind: 'demands' | 'descriptive';
  demandsOwnerId: string | null;
  body: Localized;
  admissibleSourceKinds: SourceKind[];
  notMentionedSourceKinds: SourceKind[];
  reviewers: Reviewer[];
  /**
   * Per kind, how many of the election's quotes cite a source of it (`quotes`), and how many checked documents are of
   * it (`checked`), so removing a kind can say what it leaves unsubmittable (E2.5).
   */
  usage: Record<string, { quotes: number; checked: number }>;
}

/** The organizations a demands methodology may name (E2.2): the tenant's operator and its endorsers. */
export interface DemandsOwnerOption {
  id: string;
  name: Localized;
  role: 'operator' | 'endorser';
}

/**
 * An election's methodology (editorial workflow E2), its named external reviewers (E3), and how its source kinds are
 * used; null when there is none yet. Every member reads them.
 */
export const getMethodology = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<Methodology | null> => {
  const row = await trx
    .selectFrom('app.methodologies')
    .select([
      'id',
      'kind',
      'demands_owner_id',
      'body',
      // Arrays of an enum, which node-postgres reads as text unless they are cast.
      sql<SourceKind[]>`admissible_source_kinds::text[]`.as('admissible'),
      sql<SourceKind[]>`not_mentioned_source_kinds::text[]`.as('not_mentioned'),
    ])
    .where('election_id', '=', electionId)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  if (!isLocalized(row.body)) {
    throw new Error('methodologies.body is not localized text');
  }
  const reviewers = await trx
    .selectFrom('app.methodology_reviewers')
    .select(['id', 'name', 'affiliation', 'display_order', 'retired_at'])
    .where('methodology_id', '=', row.id)
    .orderBy('display_order')
    .orderBy('name')
    .execute();
  const quotes = await trx
    .selectFrom('app.draft_evidence as q')
    .innerJoin('app.source_documents as s', 's.id', 'q.source_document_id')
    .select([sql<string>`s.kind::text`.as('kind'), (eb) => eb.fn.countAll<string>().as('n')])
    .where('q.election_id', '=', electionId)
    .groupBy('s.kind')
    .execute();
  const checked = await trx
    .selectFrom('app.draft_checked_documents as d')
    .innerJoin('app.source_documents as s', 's.id', 'd.source_document_id')
    .select([sql<string>`s.kind::text`.as('kind'), (eb) => eb.fn.countAll<string>().as('n')])
    .where('d.election_id', '=', electionId)
    .groupBy('s.kind')
    .execute();
  const usage = Object.fromEntries(
    SOURCE_KINDS.map((kind) => [
      kind,
      {
        quotes: Number(quotes.find((q) => q.kind === kind)?.n ?? 0),
        checked: Number(checked.find((c) => c.kind === kind)?.n ?? 0),
      },
    ]),
  );
  return {
    id: row.id,
    kind: row.kind,
    demandsOwnerId: row.demands_owner_id,
    body: row.body,
    admissibleSourceKinds: row.admissible,
    notMentionedSourceKinds: row.not_mentioned,
    reviewers: reviewers.map((r) => ({
      id: r.id,
      name: r.name,
      affiliation: r.affiliation,
      displayOrder: r.display_order,
      retired: r.retired_at !== null,
    })),
    usage,
  };
};

export const listDemandsOwners = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<DemandsOwnerOption[]> =>
  (
    await trx
      .selectFrom('app.tenant_organizations as t')
      .innerJoin('app.organizations as o', 'o.id', 't.organization_id')
      .select(['o.id', 'o.display_name', 't.role'])
      .where('t.tenant_id', '=', tenantId)
      .orderBy('t.role', 'desc')
      .orderBy('t.display_order')
      .execute()
  ).map((row) => {
    if (!isLocalized(row.display_name)) {
      throw new Error('organizations.display_name is not localized text');
    }
    return { id: row.id, name: row.display_name, role: row.role };
  });

export interface MethodologyFields {
  demandsOwnerId: string | null;
  body: Localized;
  admissibleSourceKinds: SourceKind[];
  notMentionedSourceKinds: SourceKind[];
}

/**
 * Writes an election's one methodology (E2): country admins and platform admins (RLS), while the election is a draft
 * (once live, change control). Its kind is the tenant's and isn't chosen (`structure_rules` refuses another); a
 * demands methodology names the operator or an endorser (the check and the trigger).
 */
export const saveMethodology = async (
  trx: Transaction<DB>,
  tenant: { id: string; methodologyKind: 'demands' | 'descriptive' },
  electionId: string,
  fields: MethodologyFields,
): Promise<ChangeResult> => {
  const values = {
    demands_owner_id: fields.demandsOwnerId,
    body: JSON.stringify(fields.body),
    admissible_source_kinds: fields.admissibleSourceKinds,
    not_mentioned_source_kinds: fields.notMentionedSourceKinds,
  };
  const existing = await trx
    .selectFrom('app.methodologies')
    .select('id')
    .where('election_id', '=', electionId)
    .executeTakeFirst();
  if (!existing) {
    await trx
      .insertInto('app.methodologies')
      .values({
        tenant_id: tenant.id,
        election_id: electionId,
        kind: tenant.methodologyKind,
        ...values,
      })
      .execute();
    return 'changed';
  }
  const updated = await trx
    .updateTable('app.methodologies')
    .set(values)
    .where('id', '=', existing.id)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : 'forbidden';
};

export const deleteMethodology = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<ChangeResult> => {
  const deleted = await trx
    .deleteFrom('app.methodologies')
    .where('election_id', '=', electionId)
    .returning('id')
    .executeTakeFirst();
  if (deleted) {
    return 'changed';
  }
  const visible = await trx
    .selectFrom('app.methodologies')
    .select('id')
    .where('election_id', '=', electionId)
    .executeTakeFirst();
  return visible ? 'forbidden' : 'not-found';
};

export interface ReviewerFields {
  name: string;
  affiliation: string;
  displayOrder: number;
}

/**
 * The methodology's named external reviewers (E3): country admins and platform admins add, change and delete them in
 * a draft election (RLS); their names are personal data, never audited. That the person agreed to be named is the
 * form's confirmation (W10), not stored.
 */
export const addReviewer = async (
  trx: Transaction<DB>,
  tenantId: string,
  methodologyId: string,
  fields: ReviewerFields,
): Promise<{ id: string }> =>
  trx
    .insertInto('app.methodology_reviewers')
    .values({
      tenant_id: tenantId,
      methodology_id: methodologyId,
      name: fields.name,
      affiliation: fields.affiliation,
      display_order: fields.displayOrder,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const updateReviewer = async (
  trx: Transaction<DB>,
  methodologyId: string,
  reviewerId: string,
  fields: ReviewerFields,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.methodology_reviewers')
    .set({ name: fields.name, affiliation: fields.affiliation, display_order: fields.displayOrder })
    .where('methodology_id', '=', methodologyId)
    .where('id', '=', reviewerId)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : reviewerRefusal(trx, methodologyId, reviewerId);
};

export const deleteReviewer = async (
  trx: Transaction<DB>,
  methodologyId: string,
  reviewerId: string,
): Promise<ChangeResult> => {
  const deleted = await trx
    .deleteFrom('app.methodology_reviewers')
    .where('methodology_id', '=', methodologyId)
    .where('id', '=', reviewerId)
    .returning('id')
    .executeTakeFirst();
  return deleted ? 'changed' : reviewerRefusal(trx, methodologyId, reviewerId);
};

const reviewerRefusal = async (
  trx: Transaction<DB>,
  methodologyId: string,
  reviewerId: string,
): Promise<ChangeResult> =>
  (await trx
    .selectFrom('app.methodology_reviewers')
    .select('id')
    .where('methodology_id', '=', methodologyId)
    .where('id', '=', reviewerId)
    .executeTakeFirst())
    ? 'forbidden'
    : 'not-found';

/** The id of an election's methodology, if it has one: what a reviewer belongs to. */
export const methodologyIdOf = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<string | undefined> =>
  (
    await trx
      .selectFrom('app.methodologies')
      .select('id')
      .where('election_id', '=', electionId)
      .executeTakeFirst()
  )?.id;
