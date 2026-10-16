import type { createAuthPool } from '@aiontheballot/db/auth-pool';

import { passwordLinkRow } from './password-link-rows.js';

type AuthPool = ReturnType<typeof createAuthPool>;

/**
 * The owner's reset of a lost authenticator (editorial workflow A5.4, ADR-0002 §10): for a member who has lost both
 * their authenticator and their backup codes. It removes the account's second factor (its TOTP secret and backup
 * codes, with any lock from wrong codes) and ends every session it has, so the next sign-in with the password leads to
 * enrolment, as for a new account. The password, the account's memberships and a platform admin's row stay; every
 * policy gives the account nothing until it has enrolled again and signed in with a code (ADR-0002 §9).
 *
 * It runs as aiontheballot_auth, like Better Auth in the API (no new grant), and reads nothing about the account but
 * its id, whether it has a second factor and how many sessions it has, so the command prints no personal data.
 */

/** What the owner sees before a reset: the account's id, whether it has a second factor, its open sessions. */
export interface AuthenticatorAccount {
  userId: string;
  /** Enrolled, or a factor stored all the same (one Better Auth would refuse to replace at enrolment). */
  enrolled: boolean;
  sessions: number;
}

/**
 * Whether the account has a second factor: enrolled, or holding a stored one, which enrolment can't replace. The owner's
 * link for a forgotten password (accounts.ts, D19) asks the same, so both commands call one account the same thing.
 */
export const HAS_FACTOR = `(coalesce(u.two_factor_enabled, false)
                     OR EXISTS (SELECT 1 FROM two_factors f WHERE f.user_id = u.id))`;

/** The account with this email address, as Better Auth stores it (trimmed, in lowercase); undefined if none has it. */
export const findAuthenticatorAccount = async (
  pool: AuthPool,
  email: string,
): Promise<AuthenticatorAccount | undefined> => {
  const { rows } = await pool.query<{ id: string; enrolled: boolean; sessions: number }>(
    `SELECT u.id, ${HAS_FACTOR} AS enrolled,
            (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
       FROM users u
      WHERE u.email = $1`,
    [email.trim().toLowerCase()],
  );
  const [row] = rows;
  return row ? { userId: row.id, enrolled: row.enrolled, sessions: row.sessions } : undefined;
};

export type ResetOutcome =
  | { kind: 'reset'; sessions: number }
  /** No account has this id (deleted meanwhile). */
  | { kind: 'unknown' }
  /** It has no second factor, so it enrols at its next sign-in already: nothing was changed. */
  | { kind: 'not-enrolled' };

/**
 * Removes the account's second factor and ends its sessions, in one transaction. A code being checked at that moment
 * can't leave a session behind: an aal2 session is inserted only while the account's factor row exists, and the
 * insert locks it, then the account's row (its foreign key); the reset locks them in the same order, so one waits for
 * the other, never both for each other. A session inserted first is deleted with the others; one inserted after finds
 * no factor and is refused (migration aal2_needs_second_factor). Sign-ins waiting for a code (Better Auth's `2fa-`
 * challenges) are deleted too; they could never finish with no factor left, and their attempt counters expire with
 * them.
 */
export const resetAuthenticator = async (pool: AuthPool, userId: string): Promise<ResetOutcome> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM two_factors WHERE user_id = $1 FOR UPDATE', [userId]);
    const { rows } = await client.query<{ enrolled: boolean }>(
      `SELECT ${HAS_FACTOR} AS enrolled FROM users u WHERE u.id = $1 FOR UPDATE OF u`,
      [userId],
    );
    const [account] = rows;
    if (!account?.enrolled) {
      await client.query('ROLLBACK');
      return account ? { kind: 'not-enrolled' } : { kind: 'unknown' };
    }
    // Expired ones go too, but only open ones are counted, as the confirmation counted them. Before the factor: its
    // removal ends any left (and revokes the member's tokens; migration member_tokens), and none can open meanwhile,
    // the factor's row being locked.
    const ended = await client.query<{ open: boolean }>(
      'DELETE FROM sessions WHERE user_id = $1 RETURNING expires_at > now() AS open',
      [userId],
    );
    await client.query('DELETE FROM two_factors WHERE user_id = $1', [userId]);
    await client.query(
      'UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE id = $1',
      [userId],
    );
    // And its unused links to choose a password: by email they go only to an account with its second factor
    // (ADR-0002 §10), and with that gone, one would let whoever reads its mailbox set a password and enrol their own.
    await client.query(
      `DELETE FROM verifications v
        WHERE v.value = $1
          AND (v.identifier LIKE '2fa-%' OR v.identifier LIKE 'trust-device-%' OR (${passwordLinkRow('v')}))`,
      [userId],
    );
    await client.query('COMMIT');
    return { kind: 'reset', sessions: ended.rows.filter((row) => row.open).length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
