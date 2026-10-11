import type { createAuthPool } from '@aiontheballot/db/auth-pool';

/** An account's name and, when asked for, its email, as Better Auth keeps them. Both are personal data. */
export interface Profile {
  name: string;
  email?: string;
}

/** The profiles of the given accounts; an id with no account (deleted, say) is left out. */
export type ProfileSource = (
  userIds: readonly string[],
  options: { emails: boolean },
) => Promise<Map<string, Profile>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Names and emails live in Better Auth's tables, which only aiontheballot_auth reaches (ADR-0002 §2), so they are read
 * there, by id, for exactly the accounts a route already found under RLS in the actor's transaction: the members of a
 * tenant they may open (PLAN R94). Emails are read only when the actor will see them (A7.1: country admins and platform
 * admins); nothing is read for anyone else, and nothing else of the account is.
 */
export const createProfileSource =
  (pool: ReturnType<typeof createAuthPool>): ProfileSource =>
  async (userIds, { emails }) => {
    const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) {
      return new Map();
    }
    const { rows } = await pool.query<{ id: string; name: string; email?: string }>(
      emails
        ? 'SELECT id, name, email FROM auth.users WHERE id = ANY($1::uuid[])'
        : 'SELECT id, name FROM auth.users WHERE id = ANY($1::uuid[])',
      [ids],
    );
    return new Map(
      rows.map(({ id, name, email }) => [
        id,
        emails ? { name, ...(email ? { email } : {}) } : { name },
      ]),
    );
  };
