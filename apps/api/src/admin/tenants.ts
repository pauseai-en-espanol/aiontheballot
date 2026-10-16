import type { DB } from '@aiontheballot/db/generated/db';
import type { MethodologyKind } from '@aiontheballot/domain/methodology';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { readTheme, type SiteTheme } from '@aiontheballot/domain/site-theme';
import { sql, type Transaction } from 'kysely';

import type { Access, TenantRole } from './access.js';

export interface TenantSummary {
  slug: string;
  name: Localized;
  defaultLocale: string;
}

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

/**
 * The tenants a signed-in user may open (editorial workflow A6): read in the caller's `withActor` transaction, so RLS
 * decides. A member sees the tenants they hold a role in, a platform admin every tenant, and a session without TOTP
 * nothing at all, since every policy helper requires aal2 (ADR-0002 §9).
 */
export const listTenants = async (trx: Transaction<DB>): Promise<TenantSummary[]> => {
  const rows = await trx
    .selectFrom('app.tenants')
    .select(['slug', 'display_name', 'default_locale'])
    .orderBy('slug')
    .execute();
  return rows.map((row) => ({
    slug: row.slug,
    name: localized(row.display_name, 'tenants.display_name'),
    defaultLocale: row.default_locale,
  }));
};

/** A tenant as its admin screens show it: who it is, its settings (§5, P1), and what the actor holds there. */
export interface TenantOverview {
  tenant: TenantSummary & {
    enabledLocales: string[];
    countryCode: string;
    methodologyKind: MethodologyKind;
    active: boolean;
    reportRetentionDays: number;
    liveEditsNeedSecondApprover: boolean;
    /** The site's own colours (T1), those it can draw. */
    theme: SiteTheme;
  };
  roles: TenantRole[];
  platformAdmin: boolean;
}

export const tenantOverview = async (
  trx: Transaction<DB>,
  access: Access,
): Promise<TenantOverview> => {
  const row = await trx
    .selectFrom('app.tenants')
    .select([
      'slug',
      'display_name',
      'default_locale',
      // An array of a domain, which node-postgres reads as text unless it is cast.
      sql<string[]>`enabled_locales::text[]`.as('enabled_locales'),
      'country_code',
      'methodology_kind',
      'active',
      'report_retention_days',
      'live_edits_need_second_approver',
      'theme',
    ])
    .where('id', '=', access.tenantId)
    .executeTakeFirstOrThrow();
  return {
    tenant: {
      slug: row.slug,
      name: localized(row.display_name, 'tenants.display_name'),
      defaultLocale: row.default_locale,
      enabledLocales: row.enabled_locales,
      countryCode: row.country_code,
      methodologyKind: row.methodology_kind,
      active: row.active,
      reportRetentionDays: row.report_retention_days,
      liveEditsNeedSecondApprover: row.live_edits_need_second_approver,
      theme: readTheme(row.theme),
    },
    roles: access.roles,
    platformAdmin: access.platformAdmin,
  };
};
