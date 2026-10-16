import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { superuserUrl } from './env.js';
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

describe('the same bytes, restricted and not (PLAN R200; BRIEF invariant 5, T17; the review of R195)', () => {
  /** A new brand asset with the bytes of fixture `of`, restricted or not (the columns the admin role may write). */
  const copy = (of: string, restricted: boolean) =>
    `INSERT INTO app.brand_assets (name, restricted, content_type, sha256, byte_size)
     SELECT 'Copia de ejemplo', ${restricted}, content_type, sha256, byte_size
       FROM app.brand_assets WHERE id = '${of}'`;
  /** A new brand asset of bytes no fixture has, restricted or not, under `name`. */
  const fresh = (restricted: boolean, name = 'Imagen nueva de ejemplo') =>
    `INSERT INTO app.brand_assets (name, restricted, content_type, sha256, byte_size)
     VALUES ('${name}', ${restricted}, 'image/png', encode(sha256('ejemplo R200'), 'hex'), 12)`;
  /**
   * Outside any role or actor, as a superuser: the stand-in for the owner's scripts, which RLS doesn't bind either
   * (no table forces it). Deferred checks run at the end of each statement.
   */
  const unbound = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
    inRolledBackTransaction(async (client) => {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      return fn(client);
    });

  it('are never an unrestricted copy of a restricted asset, the one way around who may use it', async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(c, copy(BRAND_ASSETS.restricted.id, false)),
      ),
    ).toBe(CHECK_VIOLATION);
    // Nor by SQL outside the admin role.
    expect(await unbound((c) => errorCode(c, copy(BRAND_ASSETS.restricted.id, false)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('are never a restricted copy of an unrestricted asset either, which the copy would leave usable', async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) => errorCode(c, copy(BRAND_ASSETS.shared.id, true))),
    ).toBe(CHECK_VIOLATION);
  });

  it('may be two assets of the same restriction, but neither then becomes restricted alone', async () => {
    // Two new ones that nothing selects, so that only this rule can refuse (the re-review of R200).
    const codes = await actingAs(USERS.platformAdmin, async (c) => [
      await errorCode(c, fresh(false, 'Imagen de ejemplo 1')),
      await errorCode(c, fresh(false, 'Imagen de ejemplo 2')),
      await errorCode(
        c,
        `UPDATE app.brand_assets SET restricted = true WHERE name = 'Imagen de ejemplo 1'`,
      ),
      await errorCode(
        c,
        `UPDATE app.brand_assets SET restricted = true WHERE name = 'Imagen de ejemplo 2'`,
      ),
    ]);
    expect(codes).toEqual([null, null, CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it('let copies change their restriction together, checked once the transaction ends', async () => {
    // One statement after another, each leaving the bytes both ways until the last: only the end counts.
    const codes = await actingAs(
      USERS.platformAdmin,
      async (c) => [
        await errorCode(c, copy(BRAND_ASSETS.unused.id, true)),
        await errorCode(
          c,
          `UPDATE app.brand_assets SET restricted = false WHERE name = 'Copia de ejemplo'`,
        ),
        await errorCode(
          c,
          `UPDATE app.brand_assets SET restricted = false WHERE id = '${BRAND_ASSETS.unused.id}'`,
        ),
        await errorCode(c, 'SET CONSTRAINTS ALL IMMEDIATE'),
      ],
      false,
    );
    expect(codes).toEqual([null, null, null, null]);
    // One of them alone, though, is refused when the transaction ends.
    expect(
      await actingAs(
        USERS.platformAdmin,
        async (c) => {
          await c.query(copy(BRAND_ASSETS.unused.id, true));
          await c.query(
            `UPDATE app.brand_assets SET restricted = false WHERE name = 'Copia de ejemplo'`,
          );
          return errorCode(c, 'SET CONSTRAINTS ALL IMMEDIATE');
        },
        false,
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('let an asset with no copy change its restriction, either way', async () => {
    const codes = await actingAs(USERS.platformAdmin, async (c) => [
      await errorCode(
        c,
        `UPDATE app.brand_assets SET restricted = false WHERE id = '${BRAND_ASSETS.unused.id}'`,
      ),
      await errorCode(
        c,
        `UPDATE app.brand_assets SET restricted = true WHERE id = '${BRAND_ASSETS.unused.id}'`,
      ),
    ]);
    expect(codes).toEqual([null, null]);
  });

  it("can't take another asset's bytes by a change of its own, outside the admin role either", async () => {
    expect(
      await unbound((c) =>
        errorCode(
          c,
          `UPDATE app.brand_assets SET sha256 = (SELECT sha256 FROM app.brand_assets WHERE id = '${BRAND_ASSETS.restricted.id}')
            WHERE id = '${BRAND_ASSETS.shared.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('are checked one transaction at a time: a second sees the row the first committed while it waited', async () => {
    // Two connections, and the first commits (the re-review of R200): the second, storing the same new bytes
    // unrestricted, waits for the first's check to end rather than pass unaware of it, then sees its row and is
    // refused. Were the lock taken after the check's read, or not at all, the second would pass. The first's row is
    // removed after, past the rules and unaudited, so no other test sees it go (as change-control.spec.ts does).
    const first = new pg.Client({ connectionString: superuserUrl() });
    const watcher = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([first.connect(), watcher.connect()]);
    try {
      await first.query('BEGIN');
      await first.query('SET CONSTRAINTS ALL IMMEDIATE');
      await first.query(fresh(true));
      const code = await unbound(async (second) => {
        const { rows } = await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        let settled = false;
        const attempt = errorCode(second, fresh(false)).finally(() => {
          settled = true;
        });
        // Until it waits for the first's lock, or has ended without waiting.
        for (let tries = 0; tries < 250 && !settled; tries += 1) {
          const waiting = await watcher.query(
            `SELECT 1 FROM pg_stat_activity
              WHERE pid = $1 AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
            [rows[0]?.pid],
          );
          if (waiting.rows.length > 0) {
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await first.query('COMMIT');
        return attempt;
      });
      expect(code).toBe(CHECK_VIOLATION);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await watcher.query('BEGIN');
      await watcher.query('SET LOCAL session_replication_role = replica');
      await watcher.query(
        `DELETE FROM app.brand_assets WHERE sha256 = encode(sha256('ejemplo R200'), 'hex')`,
      );
      await watcher.query('COMMIT');
      await Promise.all([first.end(), watcher.end()]);
    }
  });

  it.each(['repeatable read', 'serializable'])(
    "aren't written under %s, where the check would miss a row committed meanwhile",
    async (level) => {
      const code = await inRolledBackTransaction(async (c) => {
        await c.query(`SET TRANSACTION ISOLATION LEVEL ${level.toUpperCase()}`);
        await c.query('SET CONSTRAINTS ALL IMMEDIATE');
        return errorCode(c, fresh(false));
      });
      expect(code).toBe('25000');
    },
  );
});
