import type { createAuthPool } from '@aiontheballot/db/auth-pool';

import { createHash, randomBytes } from 'node:crypto';

type AuthPool = ReturnType<typeof createAuthPool>;

/**
 * A member's tokens for tools (ADR-0008, PLAN R203), as Better Auth's role, the only one that reaches them. A token is
 * `aiontheballot_` and 32 random bytes (base64url): the prefix lets a secret scanner recognise one. Only its SHA-256
 * is stored; the database checks how it is minted and revoked (migration member_tokens).
 */
export const TOKEN_PREFIX = 'aiontheballot_';
const TOKEN = /^aiontheballot_[\w-]{43}$/;

/** At most this long, and this many unrevoked, unexpired tokens per member: a few tools, not a fleet. */
export const MAX_DAYS = 30;
export const MAX_ACTIVE = 5;
const MAX_NAME = 80;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface TokenSummary {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** As the database's clock has it, so the admin needs none of its own. */
  status: 'active' | 'expired' | 'revoked';
}

export class TokenRefusal extends Error {
  constructor(readonly reason: 'name' | 'days' | 'tooMany') {
    super(reason);
  }
}

export interface MemberTokens {
  /** The member and token a request's token stands for, if it is unrevoked, unexpired and its member enrolled. */
  find: (token: string) => Promise<{ userId: string; tokenId: string } | undefined>;
  /** A new token, from the member's session; shown once. */
  mint: (input: {
    userId: string;
    sessionId: string;
    name: string;
    days: number;
  }) => Promise<{ token: string; summary: TokenSummary }>;
  /** The member's tokens, newest first: the unrevoked ones, and those revoked or expired in the last 30 days. */
  list: (userId: string) => Promise<TokenSummary[]>;
  /** Revokes one of the member's tokens; false if they have no such token unrevoked. */
  revoke: (userId: string, tokenId: string) => Promise<boolean>;
}

const SUMMARY = `id, name, created_at AS "createdAt", expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
                 revoked_at AS "revokedAt",
                 CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired'
                      ELSE 'active' END AS status`;

const iso = (value: unknown): string | null =>
  value === null ? null : new Date(value as string | Date).toISOString();

const summary = (row: Record<string, unknown>): TokenSummary => ({
  id: String(row['id']),
  name: String(row['name']),
  createdAt: iso(row['createdAt'])!,
  expiresAt: iso(row['expiresAt'])!,
  lastUsedAt: iso(row['lastUsedAt']),
  revokedAt: iso(row['revokedAt']),
  status: row['status'] as TokenSummary['status'],
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const createMemberTokens = (pool: AuthPool): MemberTokens => ({
  find: async (token) => {
    if (!TOKEN.test(token)) {
      return undefined;
    }
    const { rows } = await pool.query<{ id: string; user_id: string; stale: boolean }>(
      `SELECT t.id, t.user_id,
              (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute') AS stale
         FROM auth.member_tokens t JOIN auth.users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()
          AND u.two_factor_enabled
          AND EXISTS (SELECT 1 FROM auth.two_factors f WHERE f.user_id = t.user_id AND f.verified IS NOT FALSE)`,
      [hashOf(token)],
    );
    const [found] = rows;
    if (!found) {
      return undefined;
    }
    // When it was last used, for the member's list: at most once a minute, not on every request.
    if (found.stale) {
      await pool.query(
        'UPDATE auth.member_tokens SET last_used_at = now() WHERE id = $1 AND revoked_at IS NULL',
        [found.id],
      );
    }
    return { userId: found.user_id, tokenId: found.id };
  },

  mint: async ({ userId, sessionId, name, days }) => {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > MAX_NAME) {
      throw new TokenRefusal('name');
    }
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      throw new TokenRefusal('days');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Counted under the account's row, which minting takes anyway, so two at once can't both pass.
      await client.query('SELECT 1 FROM auth.users WHERE id = $1 FOR UPDATE', [userId]);
      const { rows: counted } = await client.query<{ active: number }>(
        `SELECT count(*)::int AS active FROM auth.member_tokens
          WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
        [userId],
      );
      if ((counted[0]?.active ?? 0) >= MAX_ACTIVE) {
        throw new TokenRefusal('tooMany');
      }
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
      const { rows } = await client.query(
        `INSERT INTO auth.member_tokens (user_id, session_id, name, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))
         RETURNING ${SUMMARY}`,
        [userId, sessionId, trimmed, hashOf(token), days],
      );
      await client.query('COMMIT');
      return { token, summary: summary(rows[0] as Record<string, unknown>) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  list: async (userId) => {
    const { rows } = await pool.query(
      `SELECT ${SUMMARY} FROM auth.member_tokens
        WHERE user_id = $1
          AND ((revoked_at IS NULL AND expires_at > now())
               OR least(revoked_at, expires_at) > now() - interval '30 days')
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((row) => summary(row as Record<string, unknown>));
  },

  revoke: async (userId, tokenId) => {
    if (!UUID.test(tokenId)) {
      return false;
    }
    const { rowCount } = await pool.query(
      `UPDATE auth.member_tokens SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [tokenId, userId],
    );
    return rowCount === 1;
  },
});
