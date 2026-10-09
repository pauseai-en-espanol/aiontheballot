import type pg from 'pg';

import {
  BRAND_ASSETS,
  HOSTNAMES,
  INVITATION_TOKENS,
  MEMBERSHIPS,
  ORGANIZATIONS,
  PLATFORM_ADMINS,
  PLATFORM_HOSTNAME,
  REVOKED_INVITATION_TOKEN,
  REVOKED_MEMBERSHIPS,
  TENANT_DOCUMENTS,
  type TenantKey,
  TENANTS,
  TOMBSTONE_HOSTNAME,
  USERS,
  VERIFYING_HOSTNAME,
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
  for (const [key, asset] of Object.entries(BRAND_ASSETS)) {
    await client.query(
      `INSERT INTO app.brand_assets (id, name, restricted, content_type, sha256, content)
       VALUES ($1, $2, $3, 'image/png', encode(sha256($4::bytea), 'hex'), $4::bytea)`,
      [asset.id, `Marca de ejemplo ${key}`, asset.restricted, Buffer.from(`png-${key}`)],
    );
  }
  for (const [key, org] of Object.entries(ORGANIZATIONS)) {
    await client.query(
      `INSERT INTO app.organizations (id, display_name, legal_name, is_pauseai_chapter)
       VALUES ($1, $2, $3, $4)`,
      [
        org.id,
        { es: `Organización de ejemplo ${key}` },
        `Organización de Ejemplo ${key}`,
        org.pauseai,
      ],
    );
  }
  for (const key of Object.keys(TENANTS) as TenantKey[]) {
    await client.query(
      `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
      [TENANTS[key].id, ORGANIZATIONS[key].id],
    );
    await client.query(
      `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id) VALUES ($1, 'product_logo', $2)`,
      [TENANTS[key].id, BRAND_ASSETS.shared.id],
    );
  }
  await client.query(
    'INSERT INTO app.brand_asset_grants (brand_asset_id, tenant_id) VALUES ($1, $2)',
    [BRAND_ASSETS.restricted.id, TENANTS.A.id],
  );
  await client.query(
    `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id) VALUES ($1, 'header_mark', $2)`,
    [TENANTS.A.id, BRAND_ASSETS.restricted.id],
  );
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
  const invite = (tenant: TenantKey, token: string): Promise<unknown> =>
    client.query(
      `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
       VALUES ($1, $2, 'editor', encode(sha256($3::bytea), 'hex'), now() + interval '7 days')`,
      [TENANTS[tenant].id, `persona-invitada-${tenant.toLowerCase()}@example.org`, token],
    );
  for (const [key, token] of Object.entries(INVITATION_TOKENS) as [TenantKey, string][]) {
    await invite(key, token);
  }
  await invite('A', REVOKED_INVITATION_TOKEN);
  await client.query(
    `UPDATE app.invitations SET revoked_at = now() WHERE token_hash = encode(sha256($1::bytea), 'hex')`,
    [REVOKED_INVITATION_TOKEN],
  );
  await client.query('INSERT INTO app.platform_hostnames (hostname) VALUES ($1)', [
    PLATFORM_HOSTNAME,
  ]);
  for (const h of HOSTNAMES) {
    await client.query(
      `INSERT INTO app.tenant_hostnames (hostname, tenant_id, is_canonical, verified_at)
       VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
      [h.hostname, TENANTS[h.tenant].id, h.canonical, h.verified],
    );
    if (h.retired) {
      await client.query('UPDATE app.tenant_hostnames SET retired_at = now() WHERE hostname = $1', [
        h.hostname,
      ]);
    }
  }
  await client.query(
    `INSERT INTO app.hostname_verifications (hostname, token_hash) VALUES ($1, encode(sha256('txt-a'), 'hex'))`,
    [VERIFYING_HOSTNAME],
  );
  await client.query('INSERT INTO app.hostname_tombstones (hostname) VALUES ($1)', [
    TOMBSTONE_HOSTNAME,
  ]);
  for (const doc of Object.values(TENANT_DOCUMENTS)) {
    await client.query(
      `INSERT INTO app.tenant_documents (id, tenant_id, kind, body, published_at)
       VALUES ($1, $2, 'privacy_policy', $3, CASE WHEN $4 THEN now() END)`,
      [doc.id, TENANTS[doc.tenant].id, { es: 'Política de privacidad de ejemplo' }, doc.published],
    );
  }
  await client.query('COMMIT');
};
