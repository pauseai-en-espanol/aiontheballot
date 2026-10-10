import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import {
  BRAND_ASSETS,
  ORGANIZATIONS,
  TENANT_A,
  TENANT_B,
  TENANT_INACTIVE,
  USERS,
} from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/** Runs `fn` as the superuser with the fixture platform admin as actor. */
const asPlatform = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.platformAdmin],
    );
    return fn(client);
  });

const versions = async (client: pg.Client): Promise<Record<string, number>> =>
  Object.fromEntries(
    (
      await client.query<{ tenant_id: string; version: string }>(
        'SELECT tenant_id, version FROM app.public_versions',
      )
    ).rows.map((r) => [r.tenant_id, Number(r.version)]),
  );

describe('app.brand_assets checks', () => {
  const insert = (sha: string, type = `'image/png'`, content = `'\\x89504e47'::bytea`): string =>
    `INSERT INTO app.brand_assets (name, content_type, sha256, content) VALUES ('Logo', ${type}, ${sha}, ${content})`;

  it('accepts an image whose hash matches its content', async () => {
    expect(
      await asPlatform((c) => errorCode(c, insert(`encode(sha256('\\x89504e47'::bytea), 'hex')`))),
    ).toBeNull();
  });

  it.each([
    ['a hash of other content', insert(`encode(sha256('\\x00'::bytea), 'hex')`)],
    [
      'a type other than PNG, JPEG or WebP',
      insert(`encode(sha256('\\x89504e47'::bytea), 'hex')`, `'image/svg+xml'`),
    ],
    [
      'more than 2 MB',
      insert(
        `encode(sha256(decode(repeat('00', 2097153), 'hex')), 'hex')`,
        `'image/png'`,
        `decode(repeat('00', 2097153), 'hex')`,
      ),
    ],
  ])('rejects %s', async (_name, sql) => {
    expect(await asPlatform((c) => errorCode(c, sql))).toBe(CHECK_VIOLATION);
  });
});

describe('app.organizations checks', () => {
  it.each([
    ['an uppercase contact email', `contact_email = 'Contacto@example.org'`],
    ['an uppercase privacy email', `privacy_email = 'Privacidad@example.org'`],
    ['a URL that is not https', `url = 'http://example.org'`],
    ['a newsletter URL that is not https', `newsletter_url = 'http://example.org'`],
    ['an untranslated display name', `display_name = '{}'`],
  ])('rejects %s', async (_name, set) => {
    expect(
      await asPlatform((c) =>
        errorCode(c, `UPDATE app.organizations SET ${set} WHERE id = '${ORGANIZATIONS.B.id}'`),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('app.tenant_organizations', () => {
  it('allows one operator per tenant', async () => {
    expect(
      await asPlatform((c) =>
        errorCode(
          c,
          `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role)
           VALUES ('${TENANT_A}', '${ORGANIZATIONS.unlinked.id}', 'operator')`,
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });
});

describe('app.tenant_brand_selections', () => {
  it('names slots in lowercase words', async () => {
    expect(
      await asPlatform((c) =>
        errorCode(
          c,
          `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id)
           VALUES ('${TENANT_B}', 'Header Mark', '${BRAND_ASSETS.shared.id}')`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('shared rows and the public cache key', () => {
  it('bump every tenant that shows an organization, and only those', async () => {
    const [before, after] = await asPlatform(async (client) => {
      const first = await versions(client);
      await client.query(`UPDATE app.organizations SET legal_name = 'Otra' WHERE id = $1`, [
        ORGANIZATIONS.B.id,
      ]);
      await client.query(`UPDATE app.organizations SET legal_name = 'Otra' WHERE id = $1`, [
        ORGANIZATIONS.unlinked.id,
      ]);
      return [first, await versions(client)];
    });
    expect(after[TENANT_B]).toBe((before[TENANT_B] ?? 0) + 1);
    expect(after[TENANT_A]).toBe(before[TENANT_A]);
    expect(after[TENANT_INACTIVE]).toBe(before[TENANT_INACTIVE]);
  });

  it('bump every tenant that selects a brand asset', async () => {
    const [before, after] = await asPlatform(async (client) => {
      const first = await versions(client);
      await client.query(`UPDATE app.brand_assets SET name = 'Otra' WHERE id = $1`, [
        BRAND_ASSETS.restricted.id,
      ]);
      return [first, await versions(client)];
    });
    expect(after[TENANT_A]).toBe((before[TENANT_A] ?? 0) + 1);
    expect(after[TENANT_B]).toBe(before[TENANT_B]);
  });

  it("bump a tenant whose operator's logo changes", async () => {
    const [before, after] = await asPlatform(async (client) => {
      await client.query(`UPDATE app.organizations SET logo_asset_id = $1 WHERE id = $2`, [
        BRAND_ASSETS.shared.id,
        ORGANIZATIONS.B.id,
      ]);
      const first = await versions(client);
      await client.query(`UPDATE app.brand_assets SET name = 'Otra' WHERE id = $1`, [
        BRAND_ASSETS.shared.id,
      ]);
      return [first, await versions(client)];
    });
    expect(after[TENANT_B]).toBe((before[TENANT_B] ?? 0) + 1);
  });
});

describe('brand assets in the audit log', () => {
  it('never copy the image bytes, only the hash', async () => {
    const diffs = await asPlatform(async (client) => {
      await client.query(
        `INSERT INTO app.brand_assets (name, content_type, sha256, content)
         VALUES ('Logo auditado', 'image/png', encode(sha256('\\x01'::bytea), 'hex'), '\\x01'::bytea)`,
      );
      return (
        await client.query<{ diff: { new: Record<string, unknown> } }>(
          `SELECT diff FROM app.audit_log WHERE table_name = 'brand_assets' AND diff -> 'new' ->> 'name' = 'Logo auditado'`,
        )
      ).rows;
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.diff.new).not.toHaveProperty('content');
    expect(diffs[0]?.diff.new).toHaveProperty('sha256');
  });
});
