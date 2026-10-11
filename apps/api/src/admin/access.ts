import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

/** The roles a member can hold in a tenant, as `app.tenant_role` has them (ADR-0002 §8). */
export const TENANT_ROLES = ['country_admin', 'editor', 'reviewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * What a tenant is to the actor, as RLS shows it: the tenant itself, the roles the actor holds there, and whether they
 * are a platform admin. Routes use it to find the tenant the path names and to tell the admin what to offer; it never
 * decides what may be done, which the database does again on every write.
 */
export interface Access {
  tenantId: string;
  /** The tenant's languages, for localized text (editorial workflow §2.4). */
  defaultLocale: string;
  enabledLocales: string[];
  /** Territories are inside it (E1.2). */
  countryCode: string;
  methodologyKind: 'demands' | 'descriptive';
  roles: TenantRole[];
  platformAdmin: boolean;
}

/** Whether the actor is a platform admin: only platform admins see any row of `app.platform_admins`. */
export const isPlatformAdmin = async (trx: Transaction<DB>, userId: string): Promise<boolean> =>
  (await trx
    .selectFrom('app.platform_admins')
    .select('user_id')
    .where('user_id', '=', userId)
    .executeTakeFirst()) !== undefined;

/**
 * The tenant `slug` names, if the actor may open it (editorial workflow §2.1): undefined for a tenant RLS hides, which
 * the routes answer with 404, the same as one that doesn't exist.
 */
export const accessTo = async (
  trx: Transaction<DB>,
  userId: string,
  slug: string,
): Promise<Access | undefined> => {
  const tenant = await trx
    .selectFrom('app.tenants')
    .select([
      'id',
      'default_locale',
      // An array of a domain, which node-postgres reads as text unless it is cast.
      sql<string[]>`enabled_locales::text[]`.as('enabled_locales'),
      'country_code',
      'methodology_kind',
    ])
    .where('slug', '=', slug)
    .executeTakeFirst();
  if (!tenant) {
    return undefined;
  }
  const roles = await trx
    .selectFrom('app.memberships')
    .select('role')
    .where('tenant_id', '=', tenant.id)
    .where('user_id', '=', userId)
    .execute();
  return {
    tenantId: tenant.id,
    defaultLocale: tenant.default_locale,
    enabledLocales: tenant.enabled_locales,
    countryCode: tenant.country_code,
    methodologyKind: tenant.methodology_kind,
    roles: TENANT_ROLES.filter((role) => roles.some((row) => row.role === role)),
    platformAdmin: await isPlatformAdmin(trx, userId),
  };
};

/** Whether the actor holds one of `roles` in the tenant, or is a platform admin, who may do what any role may. */
export const holds = (access: Access, ...roles: TenantRole[]): boolean =>
  access.platformAdmin || access.roles.some((role) => roles.includes(role));

/**
 * Locks the tenant's row for changes only its country admins and platform admins may make (RLS gives the tenants
 * update policy's rows to them alone), so two such changes in one tenant run one after the other: removing country
 * admins (R95), starting a draft of a text (R99). `FOR NO KEY UPDATE`, so it never blocks writes elsewhere that
 * merely reference the tenant. Whether the lock was taken also says whether the actor is one of them.
 */
export const lockTenant = async (trx: Transaction<DB>, tenantId: string): Promise<boolean> =>
  (await trx
    .selectFrom('app.tenants')
    .select('id')
    .where('id', '=', tenantId)
    .forNoKeyUpdate()
    .executeTakeFirst()) !== undefined;
