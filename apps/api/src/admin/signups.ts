import type { DB } from '@aiontheballot/db/generated/db';
import type { Transaction } from 'kysely';

import { sql } from 'kysely';

/** A site's signup list, in numbers only (PLAN R119): no runtime role may read the addresses. */
export interface SignupCounts {
  /** Waiting for the person to confirm; deleted 7 days after they signed up. */
  unconfirmed: number;
  confirmed: number;
  /** Confirmed, and asking about future elections too. */
  futureElections: number;
}

/**
 * Counts a tenant's signups as the actor: RLS shows them to country admins and platform admins only, and the column
 * grants leave out the address and the token, so this can't read either.
 */
export const signupCounts = async (
  trx: Transaction<DB>,
  tenantId: string,
): Promise<SignupCounts> => {
  const row = await trx
    .selectFrom('app.signups')
    .select([
      sql<number>`count(*) FILTER (WHERE confirmed_at IS NULL)::int`.as('unconfirmed'),
      sql<number>`count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int`.as('confirmed'),
      sql<number>`count(*) FILTER (WHERE confirmed_at IS NOT NULL AND future_elections)::int`.as(
        'future_elections',
      ),
    ])
    .where('tenant_id', '=', tenantId)
    .executeTakeFirstOrThrow();
  return {
    unconfirmed: row.unconfirmed,
    confirmed: row.confirmed,
    futureElections: row.future_elections,
  };
};
