import { type Kysely, sql, type Transaction } from 'kysely';

import type { DB } from './generated/db.js';

/** The authenticated user a transaction acts for. `aal` is 2 only after TOTP (ADR-0002 §9). */
export interface Actor {
  userId: string;
  aal: 1 | 2;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction that acts for `actor` (ADR-0002 §3). The settings are transaction-local, so they can
 * never leak to the next user of the pooled connection. Every admin query must go through here.
 */
export const withActor = async <T>(
  db: Kysely<DB>,
  actor: Actor,
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> => {
  if (!UUID.test(actor.userId)) {
    throw new Error('withActor: userId must be a UUID');
  }
  if (actor.aal !== 1 && actor.aal !== 2) {
    throw new Error('withActor: aal must be 1 or 2');
  }
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.aal', ${String(actor.aal)}, true)`.execute(
      trx,
    );
    return fn(trx);
  });
};
