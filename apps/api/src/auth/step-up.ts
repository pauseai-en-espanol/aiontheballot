import type { createAuthPool } from '@aiontheballot/db/auth-pool';

/**
 * Confirming it's you again (PLAN D23): a session lasts up to a week (D22), but the riskiest actions want a second
 * factor of the last 12 hours, as sessions had before. The session's own counts (a code or a passkey created it), and
 * so does a code typed again since, which `POST /api/step-up` checks and migration session_step_ups keeps. A passkey
 * confirms by signing in afresh. A member's token never reaches these actions (ADR-0008). Runs as aiontheballot_auth.
 */

/** How recent the second factor must be. */
export const STEP_UP_SECONDS = 12 * 60 * 60;

/** Wrong codes a session may type while confirming; the last one ends it. */
export const STEP_UP_ATTEMPTS = 5;

/**
 * Whether a request to a route is one of the riskiest actions: always, or only for some bodies (an election's PATCH
 * that changes whether or how the public sees it, say), which `when` tells from the parsed body.
 */
export type RecentSecondFactor = true | { when: (body: unknown) => boolean };

/** A route's `config` that marks it as one of the riskiest actions (auth/routes.ts checks it before the route runs). */
export const RECENT_SECOND_FACTOR = { recentSecondFactor: true } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A route's `config` marking it only when its body sets one of `fields` (to anything, `false` and `null` included). */
export const recentSecondFactorFor = (
  ...fields: readonly string[]
): { recentSecondFactor: RecentSecondFactor } => ({
  recentSecondFactor: {
    when: (body) => isRecord(body) && fields.some((field) => body[field] !== undefined),
  },
});

/** A route's `config` marking it only when its body says `field: true` (a change applied as it is proposed). */
export const recentSecondFactorIf = (
  field: string,
): { recentSecondFactor: RecentSecondFactor } => ({
  recentSecondFactor: { when: (body) => isRecord(body) && body[field] === true },
});

/** Whether `request`'s route, with its body, is one of the riskiest actions. */
export const wantsRecentSecondFactor = (
  marked: RecentSecondFactor | undefined,
  body: unknown,
): boolean => marked === true || (marked !== undefined && marked.when(body));

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The route needs a second factor of the last STEP_UP_SECONDS (PLAN D23). */
    recentSecondFactor?: RecentSecondFactor;
  }
}

type AuthPool = ReturnType<typeof createAuthPool>;

export interface StepUp {
  /** Whether the session passed a second factor in the last STEP_UP_SECONDS. */
  isRecent: (sessionId: string) => Promise<boolean>;
  /**
   * Takes one of the session's attempts, before the code is checked, so attempts sent at once count each; false when
   * none is left (the session is then ended).
   */
  begin: (sessionId: string) => Promise<boolean>;
  /** The code was right: the session's second factor is recent again, and its attempts start over. */
  succeed: (sessionId: string) => Promise<void>;
  /** The code was wrong: whether that was the last attempt, which ends the session. */
  fail: (sessionId: string) => Promise<boolean>;
}

export const createStepUp = (pool: AuthPool): StepUp => {
  const end = async (sessionId: string) => {
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  };
  const attempts = async (sessionId: string) =>
    (
      await pool.query<{ failures: number }>(
        'SELECT failures FROM session_step_ups WHERE session_id = $1',
        [sessionId],
      )
    ).rows[0]?.failures ?? 0;
  return {
    isRecent: async (sessionId) => {
      const { rows } = await pool.query<{ recent: boolean }>(
        `SELECT s.aal = 2 AND greatest(s.created_at, u.second_factor_at) > now() - make_interval(secs => $2)
                  AS recent
           FROM sessions s LEFT JOIN session_step_ups u ON u.session_id = s.id
          WHERE s.id = $1`,
        [sessionId, STEP_UP_SECONDS],
      );
      return rows[0]?.recent === true;
    },
    begin: async (sessionId) => {
      const { rowCount } = await pool.query(
        `INSERT INTO session_step_ups (session_id, failures) VALUES ($1, 1)
         ON CONFLICT (session_id) DO UPDATE SET failures = session_step_ups.failures + 1
          WHERE session_step_ups.failures < $2`,
        [sessionId, STEP_UP_ATTEMPTS],
      );
      if (rowCount === 0) {
        await end(sessionId);
        return false;
      }
      return true;
    },
    succeed: async (sessionId) => {
      await pool.query(
        'UPDATE session_step_ups SET second_factor_at = now(), failures = 0 WHERE session_id = $1',
        [sessionId],
      );
    },
    fail: async (sessionId) => {
      if ((await attempts(sessionId)) >= STEP_UP_ATTEMPTS) {
        await end(sessionId);
        return true;
      }
      return false;
    },
  };
};
