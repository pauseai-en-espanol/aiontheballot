import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

import type { ChangeResult } from './settings.js';

/** What a platform admin writes about an organization (editorial workflow P2.1), but its logo. */
export interface OrganizationFields {
  displayName: Localized;
  legalName: string;
  taxId: string | null;
  address: string | null;
  registryEntry: string | null;
  contactEmail: string | null;
  privacyEmail: string | null;
  url: string | null;
  newsletterUrl: string | null;
  isPauseaiChapter: boolean;
}

/** A site the organization runs (`operator`) or endorses. */
export interface OrganizationLink {
  slug: string;
  name: Localized;
  role: 'operator' | 'endorser';
}

export interface OrganizationSummary {
  id: string;
  displayName: Localized;
  legalName: string;
  isPauseaiChapter: boolean;
  tenants: OrganizationLink[];
}

export interface Organization extends OrganizationFields {
  id: string;
  tenants: OrganizationLink[];
}

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const columns = (fields: OrganizationFields) => ({
  display_name: JSON.stringify(fields.displayName),
  legal_name: fields.legalName,
  tax_id: fields.taxId,
  address: fields.address,
  registry_entry: fields.registryEntry,
  contact_email: fields.contactEmail,
  privacy_email: fields.privacyEmail,
  url: fields.url,
  newsletter_url: fields.newsletterUrl,
  is_pauseai_chapter: fields.isPauseaiChapter,
});

const linksOf = async (trx: Transaction<DB>, organizationId?: string) => {
  let query = trx
    .selectFrom('app.tenant_organizations as l')
    .innerJoin('app.tenants as t', 't.id', 'l.tenant_id')
    .select(['l.organization_id', 't.slug', 't.display_name', 'l.role'])
    .orderBy('t.slug');
  if (organizationId !== undefined) {
    query = query.where('l.organization_id', '=', organizationId);
  }
  const rows = await query.execute();
  const byOrganization = new Map<string, OrganizationLink[]>();
  for (const row of rows) {
    const links = byOrganization.get(row.organization_id) ?? [];
    links.push({
      slug: row.slug,
      name: localized(row.display_name, 'tenants.display_name'),
      role: row.role,
    });
    byOrganization.set(row.organization_id, links);
  }
  return byOrganization;
};

/**
 * The languages an organization's name may be written in: every site's, since an organization may serve any of them
 * (it is platform-wide, spec §3.1), in code order.
 */
export const platformLanguages = async (trx: Transaction<DB>): Promise<string[]> => {
  const { rows } = await sql<{ locale: string }>`
    SELECT DISTINCT unnest(enabled_locales)::text AS locale FROM app.tenants ORDER BY 1`.execute(
    trx,
  );
  return rows.map(({ locale }) => locale);
};

/** Every organization the actor may read (all of them, for a platform admin), with the sites each serves. */
export const listOrganizations = async (trx: Transaction<DB>): Promise<OrganizationSummary[]> => {
  const [rows, links] = await Promise.all([
    trx
      .selectFrom('app.organizations')
      .select(['id', 'display_name', 'legal_name', 'is_pauseai_chapter'])
      .orderBy('legal_name')
      .orderBy('id')
      .execute(),
    linksOf(trx),
  ]);
  return rows.map((row) => ({
    id: row.id,
    displayName: localized(row.display_name, 'organizations.display_name'),
    legalName: row.legal_name,
    isPauseaiChapter: row.is_pauseai_chapter,
    tenants: links.get(row.id) ?? [],
  }));
};

/** One organization, if the actor may read it. */
export const getOrganization = async (
  trx: Transaction<DB>,
  id: string,
): Promise<Organization | undefined> => {
  const row = await trx
    .selectFrom('app.organizations')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    displayName: localized(row.display_name, 'organizations.display_name'),
    legalName: row.legal_name,
    taxId: row.tax_id,
    address: row.address,
    registryEntry: row.registry_entry,
    contactEmail: row.contact_email,
    privacyEmail: row.privacy_email,
    url: row.url,
    newsletterUrl: row.newsletter_url,
    isPauseaiChapter: row.is_pauseai_chapter,
    tenants: (await linksOf(trx, id)).get(id) ?? [],
  };
};

/**
 * A new organization (P2.1). Only platform admins may (RLS refuses anyone else's insert); the database checks the
 * emails and links (P2.2), audits it, and refreshes the pages that show it (P2.4).
 */
export const createOrganization = async (
  trx: Transaction<DB>,
  fields: OrganizationFields,
): Promise<string> => {
  const { id } = await trx
    .insertInto('app.organizations')
    .values(columns(fields))
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
};

/** Changes an organization (P2.1), as createOrganization; for anyone but a platform admin it changes nothing. */
export const updateOrganization = async (
  trx: Transaction<DB>,
  id: string,
  fields: OrganizationFields,
): Promise<ChangeResult> => {
  const updated = await trx
    .updateTable('app.organizations')
    .set(columns(fields))
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  if (updated) {
    return 'changed';
  }
  const visible = await trx
    .selectFrom('app.organizations')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  return visible ? 'forbidden' : 'not-found';
};
