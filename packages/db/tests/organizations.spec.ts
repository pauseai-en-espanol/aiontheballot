import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import {
  BRAND_ASSETS,
  FILES,
  ORGANIZATIONS,
  TENANT_A,
  TENANT_B,
  TENANT_INACTIVE,
  USERS,
} from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

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

describe('app.brand_assets checks (the bytes live on the volume, under their hash)', () => {
  const insert = (
    sha = `encode(sha256('logo'), 'hex')`,
    type = `'image/png'`,
    size = '4',
  ): string =>
    `INSERT INTO app.brand_assets (name, content_type, sha256, byte_size) VALUES ('Logo', ${type}, ${sha}, ${size})`;

  it.each(['1', '4', '2097152'])('accepts an image of %s bytes under its hash', async (size) => {
    expect(await asPlatform((c) => errorCode(c, insert(undefined, undefined, size)))).toBeNull();
  });

  it.each([
    ['a malformed hash', insert(`'../../x'`)],
    ['a type other than PNG, JPEG or WebP', insert(undefined, `'image/svg+xml'`)],
    ['more than 2 MB', insert(undefined, undefined, '2097153')],
    ['no bytes', insert(undefined, undefined, '0')],
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

describe("a tenant's uploaded brand images (migration tenant_brand_uploads)", () => {
  const select = (tenant: string, columns: string) =>
    `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id, file_id)
     VALUES ('${tenant}', 'operator_logo_on_dark', ${columns})`;

  it.each([
    [
      'both a platform asset and an upload',
      `'${BRAND_ASSETS.shared.id}', '${FILES.unusedImageA.id}'`,
    ],
    ['neither', 'NULL, NULL'],
  ])('refuses a selection naming %s', async (_name, columns) => {
    expect(await asPlatform((c) => errorCode(c, select(TENANT_A, columns)))).toBe(CHECK_VIOLATION);
  });

  it('takes an upload only from the public_assets bucket, so no source document can become public', async () => {
    expect(
      await asPlatform((c) => errorCode(c, select(TENANT_A, `NULL, '${FILES.sourceA.id}'`))),
    ).toBe(CHECK_VIOLATION);
  });

  it('takes an upload of at most 2 MB, like a platform brand asset', async () => {
    const code = await asPlatform(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
         VALUES ('${TENANT_A}', 'public_assets', 'image/png', 2097153, encode(sha256('grande'), 'hex'))
         RETURNING id`,
      );
      return errorCode(c, select(TENANT_A, `NULL, '${rows[0]?.id}'`));
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("takes only the tenant's own files", async () => {
    expect(
      await asPlatform((c) => errorCode(c, select(TENANT_B, `NULL, '${FILES.unusedImageA.id}'`))),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});
