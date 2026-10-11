import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

import { TENANT_ROLES, type TenantRole } from './access.js';

/** A tenant's member: who, by account id, and every role they hold there. */
export interface Membership {
  userId: string;
  roles: TenantRole[];
}

/**
 * The tenant's members (editorial workflow A7.1), read under RLS: every member of the tenant sees them all, a platform
 * admin those of any tenant, anyone else none. Names and emails are Better Auth's (profiles.ts).
 */
export const listMemberships = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<Membership[]> => {
  const rows = await trx
    .selectFrom('app.memberships')
    .select(['user_id', 'role'])
    .where('tenant_id', '=', tenantId)
    .orderBy('user_id')
    .execute();
  const byUser = new Map<string, TenantRole[]>();
  for (const { user_id: userId, role } of rows) {
    byUser.set(userId, [...(byUser.get(userId) ?? []), role]);
  }
  return [...byUser].map(([userId, roles]) => ({
    userId,
    roles: TENANT_ROLES.filter((role) => roles.includes(role)),
  }));
};

/**
 * Takes a lock on the tenant's row that only those who may change its memberships can take (RLS gives the update
 * policy's rows to country admins and platform admins), so two removals in one tenant run one after the other. Without
 * it, two removals at once would each still see the other's country admin and leave the tenant with none.
 * `FOR NO KEY UPDATE`, so it never blocks writes elsewhere that merely reference the tenant. Whether the lock was
 * taken also says whether the actor may manage the tenant's members at all.
 */
const lockMemberships = async (trx: Transaction<DB>, tenantId: string): Promise<boolean> =>
  (await trx
    .selectFrom('app.tenants')
    .select('id')
    .where('id', '=', tenantId)
    .forNoKeyUpdate()
    .executeTakeFirst()) !== undefined;

export type RemoveRoleResult = 'removed' | 'not-found' | 'forbidden' | 'last-country-admin';

/**
 * Removes one role from a member (editorial workflow A7.2). RLS decides who may: a country admin of the tenant or a
 * platform admin. The tenant's last country admin stays (A7.4, W7: the API's rule, not the database's), so the tenant
 * always has someone who can manage it: the other country admins are counted under the lock before the delete, since
 * a country admin who removes their own only role would see no membership of the tenant after it. A membership whose
 * account was deleted still counts (R95). A removal takes effect on the member's next request (A7.3), since policies
 * read memberships in every statement.
 */
export const removeRole = async (
  trx: Transaction<DB>,
  tenantId: string,
  userId: string,
  role: TenantRole,
): Promise<RemoveRoleResult> => {
  const manager = await lockMemberships(trx, tenantId);
  const target = await trx
    .selectFrom('app.memberships')
    .select('user_id')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('role', '=', role)
    .executeTakeFirst();
  if (!target) {
    return 'not-found';
  }
  if (!manager) {
    return 'forbidden';
  }
  if (role === 'country_admin') {
    const another = await trx
      .selectFrom('app.memberships')
      .select('user_id')
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'country_admin')
      .where('user_id', '<>', userId)
      .executeTakeFirst();
    if (!another) {
      return 'last-country-admin';
    }
  }
  const removed = await trx
    .deleteFrom('app.memberships')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .where('role', '=', role)
    .returning('user_id')
    .executeTakeFirst();
  return removed ? 'removed' : 'forbidden';
};

export type AddRoleResult = 'added' | 'not-member';

/**
 * Gives an existing member another role (editorial workflow A7.2: direct for members; anyone else needs an
 * invitation, which is the API's rule). RLS decides who may add it (a country admin of the tenant or a platform
 * admin), and the membership's key refuses a role the member already holds.
 */
export const addRole = async (
  trx: Transaction<DB>,
  tenantId: string,
  userId: string,
  role: TenantRole,
): Promise<AddRoleResult> => {
  const member = await trx
    .selectFrom('app.memberships')
    .select('user_id')
    .where('tenant_id', '=', tenantId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!member) {
    return 'not-member';
  }
  // Raw, since the generated type asks for created_by, which the stamp trigger sets and the role may not write.
  await sql`INSERT INTO app.memberships (tenant_id, user_id, role)
            VALUES (${tenantId}, ${userId}, ${role})`.execute(trx);
  return 'added';
};
