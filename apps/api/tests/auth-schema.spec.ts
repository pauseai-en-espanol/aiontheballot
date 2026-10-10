import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { authSchemaOptions } from '../src/auth/schema.js';
import { inRolledBackTransaction } from './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const pools: ReturnType<typeof createAuthPool>[] = [];
const pool = (connectionString: string, searchPath?: string) => {
  const created = createAuthPool({ connectionString, maxConnections: 2 });
  if (searchPath) {
    created.options.options = `-c search_path=${searchPath}`;
  }
  pools.push(created);
  return created;
};
afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
});

/** A schema's tables as Postgres sees them, with the schema's name taken out so two schemas compare. */
const describeSchema = async (
  trx: Parameters<Parameters<typeof inRolledBackTransaction>[0]>[0],
  schema: string,
) => {
  const strip = (text: string) => text.replaceAll(`${schema}.`, '');
  const columns = await sql<{ line: string }>`
    SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
           || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') AS line
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = ${schema} AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1`.execute(trx);
  const constraints = await sql<{ line: string }>`
    SELECT c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid) AS line
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ${schema}
     ORDER BY 1`.execute(trx);
  const indexes = await sql<{ line: string }>`
    SELECT indexdef AS line FROM pg_indexes WHERE schemaname = ${schema} ORDER BY indexname`.execute(
    trx,
  );
  return [...columns.rows, ...constraints.rows, ...indexes.rows].map((row) => strip(row.line));
};

describe("Better Auth's tables (migration auth_schema)", () => {
  it('are exactly what Better Auth generates for our options: columns, types, defaults, keys and indexes', async () => {
    // Better Auth's own migration, compiled for an empty schema, then run in a transaction that is rolled back.
    const { compileMigrations } = await getMigrations({
      database: pool(env('TEST_SUPERUSER_DATABASE_URL'), 'auth_expected'),
      ...authSchemaOptions(),
    });
    const statements = (await compileMigrations())
      .split(/;\s*\n/)
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
    expect(statements.length).toBeGreaterThan(5);
    const [expected, actual] = await inRolledBackTransaction(async (trx) => {
      await sql`CREATE SCHEMA auth_expected`.execute(trx);
      await sql`SET LOCAL search_path = auth_expected`.execute(trx);
      for (const statement of statements) {
        await sql.raw(statement).execute(trx);
      }
      return [await describeSchema(trx, 'auth_expected'), await describeSchema(trx, 'auth')];
    });
    expect(actual).toEqual(expected);
  });

  it('are enough for Better Auth signing in, enrolling TOTP and limiting attempts, as aiontheballot_auth', async () => {
    const authPool = pool(env('TEST_AUTH_DATABASE_URL'));
    const auth = betterAuth({
      ...authSchemaOptions('Ejemplo'),
      database: authPool,
      // Test values only: nothing here is a real secret or address.
      secret: 'a-test-secret-of-at-least-thirty-two-characters',
      baseURL: 'http://localhost:4000',
      advanced: {
        ...authSchemaOptions().advanced,
        ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      },
    });
    const email = `persona-${crypto.randomUUID()}@example.org`;
    const password = 'una contraseña de ejemplo';
    const address = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const created = await auth.api.signUpEmail({
      body: { name: 'Persona de ejemplo', email, password },
    });
    try {
      // A session, and a cookie to act with.
      const signedIn = await auth.api.signInEmail({
        body: { email, password },
        returnHeaders: true,
      });
      const cookie = signedIn.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
      // TOTP enrolment writes the user's two_factors row (its id from the column's default).
      const enrolment = await auth.api.enableTwoFactor({
        body: { password },
        headers: new Headers({ cookie }),
      });
      if (enrolment.method !== 'totp') {
        throw new Error(`Enrolment answered ${enrolment.method}, not TOTP`);
      }
      expect(enrolment.totpURI).toMatch(/^otpauth:\/\/totp\//);
      expect(enrolment.backupCodes).toHaveLength(10);
      // Wrong passwords from one address until the limiter answers, with a sane wait.
      const attempt = () =>
        auth.handler(
          new Request('http://localhost:4000/api/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
            body: JSON.stringify({ email, password: 'una contraseña equivocada' }),
          }),
        );
      const statuses: number[] = [];
      let limited: Response | undefined;
      for (let i = 0; i < 10 && !limited; i += 1) {
        const response = await attempt();
        statuses.push(response.status);
        limited = response.status === 429 ? response : undefined;
      }
      expect(statuses[0]).toBe(401);
      expect(limited?.status).toBe(429);
      const wait = Number(limited?.headers.get('x-retry-after'));
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(60);

      const { rows } = await authPool.query<{
        sessions: number;
        hashed: boolean;
        factors: number;
        limits: number;
      }>(
        `SELECT (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions,
                (SELECT password <> $2 FROM accounts WHERE user_id = $1 AND provider_id = 'credential') AS hashed,
                (SELECT count(*)::int FROM two_factors WHERE user_id = $1) AS factors,
                (SELECT count(*)::int FROM rate_limits WHERE key LIKE '%' || $3 || '%') AS limits`,
        [created.user.id, password, address],
      );
      expect(rows[0]).toEqual({ sessions: 2, hashed: true, factors: 1, limits: 1 });
    } finally {
      await authPool.query('DELETE FROM users WHERE id = $1', [created.user.id]);
      await authPool.query(`DELETE FROM rate_limits WHERE key LIKE '%' || $1 || '%'`, [address]);
    }
  });
});
