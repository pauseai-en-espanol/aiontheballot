import type { DB } from '@aiontheballot/db/generated/db';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql, type Transaction } from 'kysely';

/**
 * Sites (tenants), on the platform's own screens (PLAN R111, R129): created and turned on or off by platform admins,
 * who alone may (RLS: the tenants insert and update policies, the operator link). Their hostnames are shown, never
 * written here: a hostname is verified and routed by runbook and gitops (ADR-0002, Hostnames).
 */
export interface SiteFields {
  slug: string;
  name: Localized;
  /** ISO 3166-1 alpha-2; the user-assigned XA–XZ for a demo site. */
  countryCode: string;
  defaultLocale: string;
  enabledLocales: string[];
  methodologyKind: 'demands' | 'descriptive';
  operatorId: string;
  reportRetentionDays: number;
}

export interface SiteHostname {
  hostname: string;
  canonical: boolean;
  verified: boolean;
  retired: boolean;
}

export interface SiteSummary {
  slug: string;
  name: Localized;
  defaultLocale: string;
  countryCode: string;
  active: boolean;
  hostnames: SiteHostname[];
}

/** A site as its own screen shows it: its summary, its languages and methodology, and the organization running it. */
export interface SiteDetail extends SiteSummary {
  enabledLocales: string[];
  methodologyKind: 'demands' | 'descriptive';
  reportRetentionDays: number;
  operator: { id: string; name: Localized; legalName: string } | null;
  /** Its public settings (PLAN R135): open or coming soon, indexed by search engines, its Plausible script. */
  open: boolean;
  indexed: boolean;
  plausibleScript: string | null;
}

/** A site's public settings as the database names them, any of which a platform admin changes (PLAN R135). */
export interface SiteSettings {
  site_open?: boolean;
  search_indexing?: boolean;
  plausible_script?: string | null;
}

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const hostnamesOf = (trx: Transaction<DB>, tenantId?: string) => {
  let query = trx
    .selectFrom('app.tenant_hostnames')
    .select(['tenant_id', 'hostname', 'is_canonical', 'verified_at', 'retired_at'])
    .orderBy('is_canonical', 'desc')
    .orderBy('hostname');
  if (tenantId !== undefined) {
    query = query.where('tenant_id', '=', tenantId);
  }
  return query.execute();
};

const hostname = (row: Awaited<ReturnType<typeof hostnamesOf>>[number]): SiteHostname => ({
  hostname: row.hostname,
  canonical: row.is_canonical,
  verified: row.verified_at !== null,
  retired: row.retired_at !== null,
});

/** Every site the actor may see (a platform admin sees all), with its hostnames. */
export const listSites = async (trx: Transaction<DB>): Promise<SiteSummary[]> => {
  const [tenants, hostnames] = await Promise.all([
    trx
      .selectFrom('app.tenants')
      .select(['id', 'slug', 'display_name', 'default_locale', 'country_code', 'active'])
      .orderBy('slug')
      .execute(),
    hostnamesOf(trx),
  ]);
  return tenants.map((t) => ({
    slug: t.slug,
    name: localized(t.display_name, 'tenants.display_name'),
    defaultLocale: t.default_locale,
    countryCode: t.country_code,
    active: t.active,
    hostnames: hostnames.filter((h) => h.tenant_id === t.id).map(hostname),
  }));
};

/** A site by its slug, with its id for the writes below; undefined if RLS hides it or there is none. */
export const getSite = async (
  trx: Transaction<DB>,
  slug: string,
): Promise<(SiteDetail & { id: string }) | undefined> => {
  const tenant = await trx
    .selectFrom('app.tenants as t')
    .leftJoin('app.tenant_organizations as l', (join) =>
      join.onRef('l.tenant_id', '=', 't.id').on('l.role', '=', 'operator'),
    )
    .leftJoin('app.organizations as o', 'o.id', 'l.organization_id')
    .select([
      't.id',
      't.slug',
      't.display_name',
      't.country_code',
      't.active',
      't.default_locale',
      // As text[]: node-postgres doesn't parse an array of the locale domain.
      sql<string[]>`t.enabled_locales::text[]`.as('enabled_locales'),
      't.methodology_kind',
      't.report_retention_days',
      't.site_open',
      't.search_indexing',
      't.plausible_script',
      'o.id as operator_id',
      'o.display_name as operator_name',
      'o.legal_name as operator_legal_name',
    ])
    .where('t.slug', '=', slug)
    .executeTakeFirst();
  if (!tenant) {
    return undefined;
  }
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: localized(tenant.display_name, 'tenants.display_name'),
    countryCode: tenant.country_code,
    active: tenant.active,
    defaultLocale: tenant.default_locale,
    enabledLocales: tenant.enabled_locales,
    methodologyKind: tenant.methodology_kind,
    reportRetentionDays: tenant.report_retention_days,
    open: tenant.site_open,
    indexed: tenant.search_indexing,
    plausibleScript: tenant.plausible_script,
    operator:
      tenant.operator_id === null
        ? null
        : {
            id: tenant.operator_id,
            name: localized(tenant.operator_name, 'organizations.display_name'),
            legalName: tenant.operator_legal_name ?? '',
          },
    hostnames: (await hostnamesOf(trx, tenant.id)).map(hostname),
  };
};

/**
 * A new site, not yet on (`active` false), with its operator (BRIEF §3: exactly one per site; the database checks it
 * once a site is on). Its languages are the default one and the others enabled.
 */
export const createSite = async (
  trx: Transaction<DB>,
  fields: SiteFields,
): Promise<{ id: string }> => {
  const tenant = await trx
    .insertInto('app.tenants')
    .values({
      slug: fields.slug,
      display_name: JSON.stringify(fields.name),
      country_code: fields.countryCode,
      default_locale: fields.defaultLocale,
      enabled_locales: sql`${fields.enabledLocales}::text[]`,
      methodology_kind: fields.methodologyKind,
      report_retention_days: fields.reportRetentionDays,
      active: false,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('app.tenant_organizations')
    .values({ tenant_id: tenant.id, organization_id: fields.operatorId, role: 'operator' })
    .execute();
  return tenant;
};

/**
 * Turns a site on or off: on, its public addresses serve it (coming soon until it is opened); the database refuses it
 * on without an operator.
 */
export const setSiteActive = async (
  trx: Transaction<DB>,
  tenantId: string,
  active: boolean,
): Promise<boolean> =>
  (await trx
    .updateTable('app.tenants')
    .set({ active })
    .where('id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

/**
 * Changes a site's public settings (PLAN R135): whether it is open, whether search engines may index it, its Plausible
 * script. Only a platform admin may (members_may_change); the database checks the script's form.
 */
export const setSiteSettings = async (
  trx: Transaction<DB>,
  tenantId: string,
  settings: SiteSettings,
): Promise<boolean> =>
  (await trx
    .updateTable('app.tenants')
    .set(settings)
    .where('id', '=', tenantId)
    .returning('id')
    .executeTakeFirst()) !== undefined;

/** What a platform admin changes of an existing site (PLAN R195): its main language, slug and country never change. */
export interface SiteDetails {
  name: Localized;
  /** Its languages, its main one included. */
  enabledLocales: string[];
  operatorId: string;
}

/**
 * Changes a site's name, its other languages and its operator (admin forms §2, settings and platform; PLAN R195): a
 * platform admin's alone (`members_may_change`, and RLS on the operator link). A new operator replaces the old link,
 * or, already linked to the site (as an endorser), becomes its operator. At commit the database checks that an active
 * site still has one, and that the site's restricted brand images still go with a PauseAI chapter.
 */
export const setSiteDetails = async (
  trx: Transaction<DB>,
  tenantId: string,
  details: SiteDetails,
): Promise<boolean> => {
  const updated = await trx
    .updateTable('app.tenants')
    .set({
      display_name: JSON.stringify(details.name),
      enabled_locales: sql`${details.enabledLocales}::text[]`,
    })
    .where('id', '=', tenantId)
    .returning('id')
    .executeTakeFirst();
  if (!updated) {
    return false;
  }
  const current = await trx
    .selectFrom('app.tenant_organizations')
    .select('organization_id')
    .where('tenant_id', '=', tenantId)
    .where('role', '=', 'operator')
    .executeTakeFirst();
  if (current?.organization_id !== details.operatorId) {
    if (current) {
      await trx
        .deleteFrom('app.tenant_organizations')
        .where('tenant_id', '=', tenantId)
        .where('organization_id', '=', current.organization_id)
        .execute();
    }
    await sql`
      INSERT INTO app.tenant_organizations (tenant_id, organization_id, role)
      VALUES (${tenantId}, ${details.operatorId}, 'operator')
      ON CONFLICT (tenant_id, organization_id) DO UPDATE SET role = 'operator'`.execute(trx);
  }
  return true;
};
