import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { BRAND_ASSETS, ORGANIZATIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';

/** As `userId` through the admin role, with deferred checks run at the end of each statement. */
const actingAs = <T>(
  userId: string,
  fn: (client: pg.Client) => Promise<T>,
  immediate = true,
): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    if (immediate) {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    }
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    return fn(client);
  });

const select = (tenant: string, asset: string, slot = 'footer_mark'): string =>
  `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id) VALUES ('${tenant}', '${slot}', '${asset}')`;
const grant = (tenant: string, asset: string): string =>
  `INSERT INTO app.brand_asset_grants (brand_asset_id, tenant_id) VALUES ('${asset}', '${tenant}')`;

describe('restricted brand assets', () => {
  it('can be selected by a tenant whose operator is a PauseAI chapter and that holds a grant', async () => {
    expect(
      await actingAs(USERS.countryAdminA, (c) =>
        errorCode(c, select(TENANT_A, BRAND_ASSETS.restricted.id)),
      ),
    ).toBeNull();
  });

  it('cannot be selected without a grant, even by an eligible operator', async () => {
    expect(
      await actingAs(USERS.countryAdminA, (c) =>
        errorCode(c, select(TENANT_A, BRAND_ASSETS.unused.id)),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('cannot be selected by a tenant whose operator is not a chapter, even with a grant', async () => {
    const code = await actingAs(USERS.platformAdmin, async (c) => {
      await c.query(grant(TENANT_B, BRAND_ASSETS.unused.id));
      return errorCode(c, select(TENANT_B, BRAND_ASSETS.unused.id));
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it.each([
    ['revoking the grant', `DELETE FROM app.brand_asset_grants WHERE tenant_id = '${TENANT_A}'`],
    [
      'the operator ceasing to be a chapter',
      `UPDATE app.organizations SET is_pauseai_chapter = false WHERE id = '${ORGANIZATIONS.A.id}'`,
    ],
    [
      'restricting an asset that ineligible tenants select',
      `UPDATE app.brand_assets SET restricted = true WHERE id = '${BRAND_ASSETS.shared.id}'`,
    ],
  ])('re-checks every selection on %s', async (_name, sql) => {
    expect(await actingAs(USERS.platformAdmin, (c) => errorCode(c, sql))).toBe(CHECK_VIOLATION);
  });

  it('re-checks when the operator changes: another chapter keeps the selection, a non-chapter loses it', async () => {
    const replaceOperator = (chapter: boolean): Promise<string | null> =>
      actingAs(
        USERS.platformAdmin,
        async (c) => {
          await c.query(`UPDATE app.organizations SET is_pauseai_chapter = $1 WHERE id = $2`, [
            chapter,
            ORGANIZATIONS.unlinked.id,
          ]);
          await c.query(
            `DELETE FROM app.tenant_organizations WHERE tenant_id = $1 AND role = 'operator'`,
            [TENANT_A],
          );
          await c.query(
            `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role) VALUES ($1, $2, 'operator')`,
            [TENANT_A, ORGANIZATIONS.unlinked.id],
          );
          return errorCode(c, 'SET CONSTRAINTS ALL IMMEDIATE');
        },
        false,
      );
    expect([await replaceOperator(true), await replaceOperator(false)]).toEqual([
      null,
      CHECK_VIOLATION,
    ]);
  });

  it('can be an organization logo only for a PauseAI chapter', async () => {
    const codes = await actingAs(USERS.platformAdmin, async (c) => [
      await errorCode(
        c,
        `UPDATE app.organizations SET logo_asset_id = '${BRAND_ASSETS.unused.id}' WHERE id = '${ORGANIZATIONS.A.id}'`,
      ),
      await errorCode(
        c,
        `UPDATE app.organizations SET logo_asset_id = '${BRAND_ASSETS.unused.id}' WHERE id = '${ORGANIZATIONS.B.id}'`,
      ),
    ]);
    expect(codes).toEqual([null, CHECK_VIOLATION]);
  });
});
