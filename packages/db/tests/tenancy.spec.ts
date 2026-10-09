import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const INSUFFICIENT_PRIVILEGE = '42501';

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const insertTenant = (overrides: Record<string, string>, n: number): string => {
  const columns = {
    slug: `'test-probe-${n}'`,
    country_code: `'XP'`,
    default_locale: `'es'`,
    enabled_locales: `'{es}'`,
    display_name: `'{"es": "Inquilino de prueba"}'`,
    methodology_kind: `'demands'`,
    report_retention_days: '365',
    ...overrides,
  };
  return `INSERT INTO app.tenants (${Object.keys(columns).join(', ')}) VALUES (${Object.values(columns).join(', ')})`;
};

const tenantErrors = async (cases: readonly Record<string, string>[]): Promise<(string | null)[]> =>
  inRolledBackTransaction(async (client) => {
    const codes: (string | null)[] = [];
    for (const [n, overrides] of cases.entries()) {
      codes.push(await errorCode(client, insertTenant(overrides, n)));
    }
    return codes;
  });

describe('app.tenants', () => {
  it('accepts a theme of named hex colours', async () => {
    const themes = ['{}', '{"primary": "#0a0b0c", "accent_dark": "#ffffff"}'];
    expect(await tenantErrors(themes.map((t) => ({ theme: literal(t) })))).toEqual([null, null]);
  });

  it.each([
    '{"primary": "red"}',
    '{"primary": "#FFF000"}',
    '{"primary": "#123456;} body {display: none"}',
    '{"Primary": "#123456"}',
    '{"--primary": "#123456"}',
    '{"primary": {"value": "#123456"}}',
    '[]',
    '"#123456"',
  ])('rejects the theme %s: colours only, so it can never carry CSS', async (theme) => {
    expect(await tenantErrors([{ theme: literal(theme) }])).toEqual([CHECK_VIOLATION]);
  });

  it('requires the default locale to be enabled, and every locale to be well formed', async () => {
    expect(
      await tenantErrors([
        { default_locale: `'ca'` },
        { enabled_locales: `'{ES}'`, default_locale: `'es'` },
        { enabled_locales: `'{}'` },
      ]),
    ).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it('requires an ISO 3166-1 alpha-2 country code, a valid slug and a positive retention', async () => {
    expect(
      await tenantErrors([
        { country_code: `'xa'` },
        { country_code: `'XAA'` },
        { slug: `'_test'` },
        { report_retention_days: '0' },
        { llm_monthly_cap_usd: '-1' },
      ]),
    ).toEqual([
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
      CHECK_VIOLATION,
    ]);
  });
});

describe('private.members_may_change', () => {
  const setup = `
    CREATE TABLE app.guarded (id int PRIMARY KEY, open text, closed text, updated_by uuid, updated_at timestamptz);
    CREATE TRIGGER members_may_change BEFORE UPDATE ON app.guarded
      FOR EACH ROW EXECUTE FUNCTION private.members_may_change('open');
    GRANT SELECT, UPDATE ON app.guarded TO aiontheballot_admin;
    INSERT INTO app.guarded VALUES (1, 'a', 'a', NULL, NULL);`;
  const actAs = (userId: string): string =>
    `SET LOCAL ROLE aiontheballot_admin;
     SELECT set_config('app.user_id', '${userId}', true), set_config('app.aal', '2', true);`;

  it('lets anyone permitted by RLS change the listed columns, and updated_by and updated_at', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query(actAs(USERS.countryAdminA));
      expect(
        await errorCode(
          client,
          `UPDATE app.guarded SET open = 'b', updated_by = '${USERS.countryAdminA}',
                                 updated_at = now()`,
        ),
      ).toBeNull();
    });
  });

  it('refuses any other column unless the actor is a platform admin', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query(actAs(USERS.countryAdminA));
      expect(await errorCode(client, `UPDATE app.guarded SET closed = 'b'`)).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      await client.query(actAs(USERS.platformAdmin));
      expect(await errorCode(client, `UPDATE app.guarded SET closed = 'b'`)).toBeNull();
    });
  });

  it('treats a platform admin at aal1 as anyone else', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(setup);
      await client.query(actAs(USERS.platformAdmin));
      await client.query(`SELECT set_config('app.aal', '1', true)`);
      expect(await errorCode(client, `UPDATE app.guarded SET closed = 'b'`)).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

describe('policy helpers', () => {
  const helpers = async (
    userId: string,
    aal: string,
  ): Promise<{ tenants: string[]; admin: boolean }> =>
    inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', $2, true)`,
        [userId, aal],
      );
      const { rows } = await client.query<{ tenants: string[]; admin: boolean }>(
        `SELECT ARRAY(SELECT private.my_tenants('country_admin', 'editor', 'reviewer') ORDER BY 1)::text[] AS tenants,
                private.is_platform_admin() AS admin`,
      );
      return rows[0] ?? { tenants: [], admin: false };
    });

  it('return the tenants and platform-admin status of the actor at aal2', async () => {
    expect(await helpers(USERS.editorAReviewerB, '2')).toEqual({
      tenants: [TENANT_A, TENANT_B],
      admin: false,
    });
    expect(await helpers(USERS.platformAdmin, '2')).toEqual({ tenants: [], admin: true });
  });

  it('return nothing at aal1, or without an actor', async () => {
    expect(await helpers(USERS.editorAReviewerB, '1')).toEqual({ tenants: [], admin: false });
    expect(await helpers(USERS.platformAdmin, '1')).toEqual({ tenants: [], admin: false });
    expect(await helpers('', '2')).toEqual({ tenants: [], admin: false });
  });

  it('filter by role', async () => {
    const tenants = await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
        [USERS.editorAReviewerB],
      );
      return (await client.query<{ t: string }>(`SELECT private.my_tenants('reviewer') AS t`)).rows;
    });
    expect(tenants).toEqual([{ t: TENANT_B }]);
  });
});
