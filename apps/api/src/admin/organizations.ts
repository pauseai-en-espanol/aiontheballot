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
  /** Whether it has a logo (PLAN R195), which platform admins see through its own route. */
  hasLogo: boolean;
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
    hasLogo: row.logo_asset_id !== null,
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

/** The sites an organization runs or endorses, by slug: what its public details show on (R151). */
export const sitesOf = async (trx: Transaction<DB>, id: string): Promise<string[]> =>
  (
    await trx
      .selectFrom('app.tenant_organizations as o')
      .innerJoin('app.tenants as t', 't.id', 'o.tenant_id')
      .select('t.slug')
      .where('o.organization_id', '=', id)
      .orderBy('t.slug')
      .execute()
  ).map((row) => row.slug);

/** An organization's logo: an image of the platform's, whose bytes are in the platform's space (ADR-0004). */
export const organizationLogo = async (
  trx: Transaction<DB>,
  id: string,
): Promise<{ sha256: string; contentType: string } | undefined> => {
  const row = await trx
    .selectFrom('app.organizations as o')
    .innerJoin('app.brand_assets as a', 'a.id', 'o.logo_asset_id')
    .select(['a.sha256', 'a.content_type'])
    .where('o.id', '=', id)
    .executeTakeFirst();
  return row ? { sha256: row.sha256, contentType: row.content_type } : undefined;
};

/**
 * Sets an organization's logo to an image whose bytes the caller stored first in the platform's space, or removes it
 * (`null`) (admin forms §2, platform; PLAN R195). Platform admins only (RLS on both tables). The same bytes already
 * among the platform's images are that image if it is restricted, or if it is of the same type: so a restricted logo
 * stays restricted, and the database lets only a PauseAI chapter use it (at commit, `restricted_assets_are_eligible`),
 * never a second, unrestricted copy of it, which it refuses anyway (`brand_asset_restriction_is_one`). 'otherType' when
 * that restricted image's row gives the bytes another type, which serving them as would break (the reviews of R200).
 * Otherwise it becomes a new one, not restricted, named neutrally (`name`): the catalogue's names are seen by every
 * site's members. One it named before stays in the catalogue.
 */
export const setOrganizationLogo = async (
  trx: Transaction<DB>,
  id: string,
  upload: { sha256: string; byteSize: number; contentType: string; name: string } | null,
): Promise<ChangeResult | 'otherType'> => {
  let assetId: string | null = null;
  if (upload) {
    const existing = await trx
      .selectFrom('app.brand_assets')
      .select(['id', 'content_type'])
      .where('sha256', '=', upload.sha256)
      .where((eb) =>
        eb.or([eb('restricted', '=', true), eb('content_type', '=', upload.contentType)]),
      )
      .orderBy('restricted', 'desc')
      .orderBy('created_at')
      .executeTakeFirst();
    if (existing && existing.content_type !== upload.contentType) {
      return 'otherType';
    }
    assetId =
      existing?.id ??
      (
        await trx
          .insertInto('app.brand_assets')
          .values({
            name: upload.name,
            restricted: false,
            content_type: upload.contentType,
            sha256: upload.sha256,
            byte_size: upload.byteSize,
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
  }
  const updated = await trx
    .updateTable('app.organizations')
    .set({ logo_asset_id: assetId })
    .where('id', '=', id)
    .returning('id')
    .executeTakeFirst();
  return updated ? 'changed' : 'not-found';
};
