import type pg from 'pg';

import {
  MEMBERSHIPS,
  PLATFORM_ADMINS,
  REVOKED_MEMBERSHIPS,
  type TenantKey,
  TENANTS,
  USERS,
} from './matrix.js';

/** Fictional ISO 3166 user-assigned codes, one per fixture tenant. */
const COUNTRY: Readonly<Record<TenantKey, string>> = { A: 'XA', B: 'XB', inactive: 'XC' };

/**
 * Loads the matrix fixtures (ADR-0002, fixtures) into the freshly migrated test database, once per run. Rows go in
 * through the same triggers as in production, acting as the fixture platform admin; every test rolls back its own
 * changes, so the fixtures stay as they are.
 */
export const loadFixtures = async (client: pg.Client): Promise<void> => {
  await client.query('BEGIN');
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [USERS.platformAdmin],
  );
  for (const userId of PLATFORM_ADMINS) {
    await client.query('INSERT INTO app.platform_admins (user_id) VALUES ($1)', [userId]);
  }
  for (const [key, tenant] of Object.entries(TENANTS) as [
    TenantKey,
    (typeof TENANTS)[TenantKey],
  ][]) {
    await client.query(
      `INSERT INTO app.tenants (id, slug, country_code, default_locale, enabled_locales, display_name,
                               methodology_kind, active, report_retention_days)
       VALUES ($1, $2, $3, 'es', '{es}', $4, 'demands', $5, 365)`,
      [tenant.id, tenant.slug, COUNTRY[key], { es: `Inquilino de prueba ${key}` }, tenant.active],
    );
  }
  for (const m of [...MEMBERSHIPS, ...REVOKED_MEMBERSHIPS]) {
    await client.query(
      'INSERT INTO app.memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)',
      [m.user, TENANTS[m.tenant].id, m.role],
    );
  }
  for (const m of REVOKED_MEMBERSHIPS) {
    await client.query(
      'DELETE FROM app.memberships WHERE user_id = $1 AND tenant_id = $2 AND role = $3',
      [m.user, TENANTS[m.tenant].id, m.role],
    );
  }
  await client.query('COMMIT');
};
