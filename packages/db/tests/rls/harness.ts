import type pg from 'pg';

export type RuntimeRole = 'aiontheballot_web' | 'aiontheballot_admin' | 'aiontheballot_worker';

/** Who runs a case: a runtime role, plus the actor (admin) or the job's tenant (worker). ADR-0002 §2–§3. */
export interface Principal {
  /** Stable name used in test titles, e.g. "editor@A aal2". */
  id: string;
  role: RuntimeRole;
  userId?: string;
  aal?: 1 | 2;
  jobTenantId?: string;
}

export interface Case {
  principal: Principal;
  /** Runs as the principal. Writes use RETURNING, so "affected" can be counted. */
  sql: string;
  params?: unknown[];
  /** Runs as superuser before the attempt and must return exactly one row: the target exists. */
  target: string;
  targetParams?: unknown[];
}

export type Outcome =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: 'error'; code: string }
  | { kind: 'deny'; reason: 'no-rows' };

const ROLES: readonly RuntimeRole[] = [
  'aiontheballot_web',
  'aiontheballot_admin',
  'aiontheballot_worker',
];

const fingerprint = async (client: pg.Client, c: Case): Promise<string> =>
  JSON.stringify((await client.query(c.target, c.targetParams)).rows);

/**
 * Runs one case inside the caller's transaction and classifies it (ADR-0002, test matrix):
 * - allow: exactly one row visible or affected;
 * - deny: an error, or zero rows, and the target is unchanged afterwards.
 * Anything else (a missing target, several rows, a deny that still changed data) throws, so it can never pass
 * silently. Everything the case did is rolled back.
 */
export const runCase = async (client: pg.Client, c: Case): Promise<Outcome> => {
  if (!ROLES.includes(c.principal.role)) {
    throw new Error(`Unknown runtime role ${c.principal.role}`);
  }
  const before = await client.query(c.target, c.targetParams);
  if (before.rowCount !== 1) {
    throw new Error(
      `[${c.principal.id}] target must match exactly one row, matched ${before.rowCount}: ${c.target}`,
    );
  }
  const beforePrint = JSON.stringify(before.rows);

  await client.query('SAVEPOINT rls_case');
  try {
    await client.query(`SET LOCAL ROLE ${c.principal.role}`);
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', $2, true), set_config('app.tenant_id', $3, true)`,
      [
        c.principal.userId ?? '',
        c.principal.aal ? String(c.principal.aal) : '',
        c.principal.jobTenantId ?? '',
      ],
    );

    let outcome: Outcome;
    let affected = 0;
    await client.query('SAVEPOINT rls_attempt');
    try {
      affected = (await client.query(c.sql, c.params)).rowCount ?? 0;
      await client.query('RELEASE SAVEPOINT rls_attempt');
      outcome = affected === 0 ? { kind: 'deny', reason: 'no-rows' } : { kind: 'allow' };
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT rls_attempt');
      outcome = {
        kind: 'deny',
        reason: 'error',
        code: (error as { code?: string }).code ?? 'unknown',
      };
    }

    await client.query('RESET ROLE');
    if (outcome.kind === 'allow' && affected !== 1) {
      throw new Error(`[${c.principal.id}] expected exactly one row, got ${affected}: ${c.sql}`);
    }
    if (outcome.kind === 'deny' && (await fingerprint(client, c)) !== beforePrint) {
      throw new Error(`[${c.principal.id}] denied but the target changed: ${c.sql}`);
    }
    return outcome;
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT rls_case');
  }
};
