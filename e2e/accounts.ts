import { hashPassword } from 'better-auth/crypto';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}

/** A fictional password, long enough for the 12-character rule. */
export const PASSWORD = 'una contraseña de ejemplo';

const pool = (name: string) => {
  const connectionString = process.env[name];
  if (!connectionString) {
    throw new Error(`${name} is not set (see .env.example)`);
  }
  return new pg.Pool({ connectionString, max: 1 });
};

/**
 * A new account as an invitation will create it (email verified, a password, no TOTP), straight into Better Auth's
 * tables as its own role, since sign-up is closed. Each test makes its own, so tests never share a sign-in.
 */
export const createAccount = async (name = 'Persona de ejemplo') => {
  const auth = pool('AUTH_DATABASE_URL');
  try {
    const email = `persona-${crypto.randomUUID()}@example.org`;
    const { rows } = await auth.query<{ id: string }>(
      `INSERT INTO auth.users (name, email, email_verified) VALUES ($1, $2, true) RETURNING id`,
      [name, email],
    );
    const id = rows[0]?.id ?? '';
    await auth.query(
      `INSERT INTO auth.accounts (account_id, provider_id, user_id, password, updated_at)
       VALUES ($1, 'credential', $2, $3, now())`,
      [id, id, await hashPassword(PASSWORD)],
    );
    return { id, email, name };
  } finally {
    await auth.end();
  }
};

/** Removes test accounts with what they left: memberships (as the owner) and Better Auth's rows. */
export const deleteAccounts = async (ids: string[]) => {
  if (ids.length === 0) {
    return;
  }
  const owner = pool('DATABASE_URL');
  const auth = pool('AUTH_DATABASE_URL');
  try {
    await owner.query('DELETE FROM app.memberships WHERE user_id = ANY($1)', [ids]);
    await owner.query('DELETE FROM app.platform_admins WHERE user_id = ANY($1)', [ids]);
    await auth.query('DELETE FROM auth.verifications WHERE value = ANY($1)', [ids]);
    await auth.query('DELETE FROM auth.users WHERE id = ANY($1)', [ids]);
  } finally {
    await Promise.all([owner.end(), auth.end()]);
  }
};

/** Runs SQL as the database owner, as the owner runs what a command prints; returns the rows it changed. */
export const asOwner = async (sql: string, values: unknown[] = []): Promise<number> => {
  const owner = pool('DATABASE_URL');
  try {
    return (await owner.query(sql, values)).rowCount ?? 0;
  } finally {
    await owner.end();
  }
};

/**
 * A tenant of the test's own, so what it changes (members, settings, elections) touches nothing another test reads:
 * fictional, inactive (it needs no operator then), in Spanish and English, its name in both unless `english` is
 * false. Remove it with `purgeTenant`.
 */
export const createTenant = async ({ english = true }: { english?: boolean } = {}) => {
  const owner = pool('DATABASE_URL');
  try {
    const slug = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    const name = {
      es: `Sitio de prueba ${slug}`,
      ...(english ? { en: `Test site ${slug}` } : {}),
    };
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO app.tenants (slug, country_code, default_locale, enabled_locales, display_name,
                                methodology_kind, report_retention_days)
       VALUES ($1, 'XE', 'es', '{es,en}', $2, 'demands', 365) RETURNING id`,
      [slug, name],
    );
    return { id: rows[0]?.id ?? '', slug, name };
  } finally {
    await owner.end();
  }
};

/** Removes a test's tenant and everything in it, as the owner removes a tenant (ADR-0002 §14). */
export const purgeTenant = async (id: string) => {
  const owner = pool('DATABASE_URL');
  try {
    await owner.query('SELECT private.purge_tenant($1)', [id]);
  } finally {
    await owner.end();
  }
};

/** A role in a tenant, added as the database owner adds one, stamped as the member's own. */
export const addMembership = async (
  userId: string,
  tenantSlug: string,
  role: 'country_admin' | 'editor' | 'reviewer' = 'editor',
) => {
  const owner = pool('DATABASE_URL');
  const client = await owner.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(
      `INSERT INTO app.memberships (user_id, tenant_id, role)
       SELECT $1, id, $3 FROM app.tenants WHERE slug = $2`,
      [userId, tenantSlug, role],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
    await owner.end();
  }
};

/**
 * A visitor address from the documentation range (RFC 3849), so each test is its own visitor at the gateway. Random in
 * its first 64 bits, which is what Better Auth's limiter counts an IPv6 address by.
 */
export const visitorAddress = () =>
  `2001:db8:${randomInt(0, 0x10000).toString(16)}:${randomInt(0, 0x10000).toString(16)}::1`;
