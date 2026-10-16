import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

import type { Access } from './access.js';
import type { DocumentKind } from './settings.js';

import { DOCUMENT_KINDS } from './settings.js';

/**
 * What going live needs (editorial workflow E5.2), as the database's `election_rules` and `short_title_rules` will
 * check it, read under RLS for the admin to show beforehand; and what it only warns about (E5.3, W9, O3). The database
 * decides again when the status changes: this is only the screen's checklist.
 */
export interface GoLiveChecklist {
  /** Each condition the database refuses to go live without. */
  needs: {
    activeTenant: boolean;
    operator: boolean;
    methodology: boolean;
    electionName: boolean;
    methodologyText: boolean;
    /** Slugs of parties without their name or short name in the default language. */
    partiesMissingNames: string[];
    /** Slugs of criteria without their title, description or short title in the default language. */
    criteriaMissingTexts: string[];
  };
  /** What it warns about but allows. */
  warnings: {
    noParties: boolean;
    noCriteria: boolean;
    noReviewers: boolean;
    unpublishedTexts: DocumentKind[];
  };
  ready: boolean;
}

export const goLiveChecklist = async (
  trx: Transaction<DB>,
  access: Access,
  electionId: string,
): Promise<GoLiveChecklist> => {
  const locale = access.defaultLocale;
  const row = await trx
    .selectFrom('app.elections as e')
    .innerJoin('app.tenants as t', 't.id', 'e.tenant_id')
    .select([
      't.active',
      sql<boolean>`e.name ? ${locale}`.as('election_name'),
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('app.tenant_organizations as o')
              .select('o.organization_id')
              .whereRef('o.tenant_id', '=', 'e.tenant_id')
              .where('o.role', '=', 'operator'),
          )
          .as('operator'),
    ])
    .where('e.id', '=', electionId)
    .executeTakeFirstOrThrow();
  const methodology = await trx
    .selectFrom('app.methodologies')
    .select(['id', sql<boolean>`body ? ${locale}`.as('has_text')])
    .where('election_id', '=', electionId)
    .executeTakeFirst();
  const parties = await trx
    .selectFrom('app.parties')
    .select(['slug', sql<boolean>`name ? ${locale} AND short_name ? ${locale}`.as('named')])
    .where('election_id', '=', electionId)
    .orderBy('display_order')
    .orderBy('slug')
    .execute();
  const criteria = await trx
    .selectFrom('app.criteria')
    .select([
      'slug',
      sql<boolean>`title ? ${locale} AND description ? ${locale} AND coalesce(short_title ? ${locale}, false)`.as(
        'complete',
      ),
    ])
    .where('election_id', '=', electionId)
    .orderBy('display_order')
    .orderBy('slug')
    .execute();
  const reviewers = methodology
    ? await trx
        .selectFrom('app.methodology_reviewers')
        .select('id')
        .where('methodology_id', '=', methodology.id)
        .where('retired_at', 'is', null)
        .execute()
    : [];
  const published = await trx
    .selectFrom('app.tenant_documents')
    .select('kind')
    .distinct()
    .where('tenant_id', '=', access.tenantId)
    .where('published_at', 'is not', null)
    .execute();
  const needs = {
    activeTenant: row.active,
    operator: row.operator === true,
    methodology: methodology !== undefined,
    electionName: row.election_name,
    methodologyText: methodology?.has_text === true,
    partiesMissingNames: parties.filter((p) => !p.named).map((p) => p.slug),
    criteriaMissingTexts: criteria.filter((c) => !c.complete).map((c) => c.slug),
  };
  return {
    needs,
    warnings: {
      noParties: parties.length === 0,
      noCriteria: criteria.length === 0,
      noReviewers: reviewers.length === 0,
      unpublishedTexts: DOCUMENT_KINDS.filter((kind) => !published.some((d) => d.kind === kind)),
    },
    ready:
      needs.activeTenant &&
      needs.operator &&
      needs.methodology &&
      needs.electionName &&
      needs.methodologyText &&
      needs.partiesMissingNames.length === 0 &&
      needs.criteriaMissingTexts.length === 0,
  };
};
