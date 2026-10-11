import type { DB } from '@aiontheballot/db/generated/db';

import { withActor } from '@aiontheballot/db/actor';
import { createDatabase } from '@aiontheballot/db/client';
import { sql, type Transaction } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import type { TenantRole } from '../src/admin/access.js';

import { accessTo } from '../src/admin/access.js';
import { addRole, listMemberships, removeRole } from '../src/admin/members.js';
import { inRolledBackTransaction } from './db.js';
import { TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string, aal: 1 | 2 = 2) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', ${String(aal)}, true)`.execute(
    trx,
  );
};

/** A's roles, read as the owner sees them, so a refused write can be seen to have changed nothing. */
const rolesInA = async (trx: Transaction<DB>) => {
  await sql`RESET ROLE`.execute(trx);
  const { rows } = await sql<{ user_id: string; role: TenantRole }>`
    SELECT user_id, role FROM app.memberships WHERE tenant_id = ${TENANT_A} ORDER BY user_id, role`.execute(
    trx,
  );
  return rows.map((row) => `${row.user_id}:${row.role}`);
};

describe("a tenant's members (editorial workflow A7.1)", () => {
  it('shows every member of the tenant, with all their roles, to any of its members', async () => {
    const members = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.reviewerA);
      return listMemberships(trx, TENANT_A);
    });
    expect(members).toEqual(
      expect.arrayContaining([
        { userId: USERS.editorA, roles: ['editor'] },
        { userId: USERS.reviewerA, roles: ['reviewer'] },
        { userId: USERS.countryAdminA, roles: ['country_admin'] },
        // Editor in A and reviewer in B: only A's role shows here.
        { userId: USERS.editorAReviewerB, roles: ['editor'] },
      ]),
    );
    expect(members).toHaveLength(4);
  });

  it.each([
    ['a member of another tenant', USERS.countryAdminB, 2],
    ['a user with no membership', USERS.noMembership, 2],
    ['a member before TOTP', USERS.editorA, 1],
  ] as const)('shows nothing to %s', async (_name, userId, aal) => {
    const members = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, userId, aal);
      return listMemberships(trx, TENANT_A);
    });
    expect(members).toEqual([]);
  });

  it("gives a platform admin any tenant's members, and the tenant and roles the path names", async () => {
    const { members, access } = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      return {
        members: await listMemberships(trx, TENANT_A),
        access: await accessTo(trx, USERS.platformAdmin, 'test-a'),
      };
    });
    expect(members).toHaveLength(4);
    expect(access).toEqual({
      tenantId: TENANT_A,
      defaultLocale: 'es',
      enabledLocales: expect.arrayContaining(['es']),
      countryCode: expect.stringMatching(/^[A-Z]{2}$/),
      methodologyKind: 'demands',
      roles: [],
      platformAdmin: true,
    });
  });

  it("finds no tenant for someone who isn't in it", async () => {
    const access = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminB);
      return accessTo(trx, USERS.countryAdminB, 'test-a');
    });
    expect(access).toBeUndefined();
  });
});

describe('removing a role (editorial workflow A7.2, A7.4)', () => {
  it('lets a country admin remove a role, which leaves the member their other roles', async () => {
    const { result, after } = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      await addRole(trx, TENANT_A, USERS.reviewerA, 'editor');
      await actAs(trx, USERS.countryAdminA);
      const removed = await removeRole(trx, TENANT_A, USERS.reviewerA, 'reviewer');
      return { result: removed, after: await listMemberships(trx, TENANT_A) };
    });
    expect(result).toBe('removed');
    expect(after).toContainEqual({ userId: USERS.reviewerA, roles: ['editor'] });
  });

  it.each([
    ['an editor', USERS.editorA],
    ['a reviewer', USERS.reviewerA],
  ])('changes nothing for %s, who may see the role but not remove it', async (_name, userId) => {
    const { result, before, after } = await inRolledBackTransaction(async (trx) => {
      const rolesBefore = await rolesInA(trx);
      await actAs(trx, userId);
      const removed = await removeRole(trx, TENANT_A, USERS.editorAReviewerB, 'editor');
      return { result: removed, before: rolesBefore, after: await rolesInA(trx) };
    });
    expect(result).toBe('forbidden');
    expect(after).toEqual(before);
  });

  it("refuses an editor as such, even for the last country admin, whose removal they can't make", async () => {
    const result = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      return removeRole(trx, TENANT_A, USERS.countryAdminA, 'country_admin');
    });
    expect(result).toBe('forbidden');
  });

  it("answers not-found for a role the member doesn't hold, or a tenant the actor can't see", async () => {
    const results = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      const missing = await removeRole(trx, TENANT_A, USERS.editorA, 'reviewer');
      await actAs(trx, USERS.countryAdminB);
      const hidden = await removeRole(trx, TENANT_A, USERS.editorA, 'editor');
      return { missing, hidden };
    });
    expect(results).toEqual({ missing: 'not-found', hidden: 'not-found' });
  });

  it.each([
    ['the country admin themselves', USERS.countryAdminA],
    ['a platform admin', USERS.platformAdmin],
  ])("refuses to remove the tenant's last country admin, as %s", async (_name, userId) => {
    const result = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, userId);
      return removeRole(trx, TENANT_A, USERS.countryAdminA, 'country_admin');
    });
    expect(result).toBe('last-country-admin');
  });

  it('lets a country admin whose only role it is remove it, while another remains', async () => {
    const result = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      await addRole(trx, TENANT_A, USERS.reviewerA, 'country_admin');
      await actAs(trx, USERS.countryAdminA);
      return removeRole(trx, TENANT_A, USERS.countryAdminA, 'country_admin');
    });
    expect(result).toBe('removed');
  });

  it('removes a country admin while another remains', async () => {
    const result = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      await addRole(trx, TENANT_A, USERS.editorA, 'country_admin');
      await actAs(trx, USERS.editorA);
      return removeRole(trx, TENANT_A, USERS.countryAdminA, 'country_admin');
    });
    expect(result).toBe('removed');
  });
});

describe('giving a member another role (editorial workflow A7.2)', () => {
  it('adds a role to an existing member, as a country admin', async () => {
    const after = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      expect(await addRole(trx, TENANT_A, USERS.editorA, 'reviewer')).toBe('added');
      return listMemberships(trx, TENANT_A);
    });
    expect(after).toContainEqual({ userId: USERS.editorA, roles: ['editor', 'reviewer'] });
  });

  it('refuses anyone who is not yet a member: they need an invitation', async () => {
    const result = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      // A member of B only.
      return addRole(trx, TENANT_A, USERS.countryAdminB, 'editor');
    });
    expect(result).toBe('not-member');
  });

  it('leaves the refusal to the database for an editor, and for a role already held', async () => {
    const editor = inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      return addRole(trx, TENANT_A, USERS.reviewerA, 'editor');
    });
    await expect(editor).rejects.toMatchObject({ code: '42501' });
    const held = inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      return addRole(trx, TENANT_A, USERS.reviewerA, 'reviewer');
    });
    await expect(held).rejects.toMatchObject({ code: '23505', constraint: 'memberships_pkey' });
  });
});

describe('two removals of country admins at once', () => {
  const env = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not set. Copy .env.example to .env.`);
    }
    return value;
  };
  const admin = createDatabase({
    connectionString: env('TEST_ADMIN_DATABASE_URL'),
    maxConnections: 2,
  });
  const owner = createDatabase({
    connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
    maxConnections: 1,
  });

  afterAll(async () => {
    await admin.destroy();
    await owner.destroy();
  });

  /**
   * The removal as the route makes it, refused (and rolled back) unless removed. With `held`, it says when it has
   * removed the role and keeps its transaction open until `hold` settles.
   */
  const remove = (
    actor: string,
    target: string,
    { held, hold }: { held?: () => void; hold?: Promise<void> } = {},
  ) =>
    withActor(admin, { userId: actor, aal: 2 }, async (trx) => {
      const result = await removeRole(trx, TENANT_A, target, 'country_admin');
      if (result !== 'removed') {
        throw new Error(result);
      }
      held?.();
      await hold;
      return result;
    }).catch((error: unknown) => (error instanceof Error ? error.message : 'unexpected'));

  /** A country admin of A, added as the owner adds one (committed, so both transactions see it). */
  const addCountryAdmin = (userId: string) =>
    owner.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${userId}, true)`.execute(trx);
      await sql`INSERT INTO app.memberships (user_id, tenant_id, role)
                VALUES (${userId}, ${TENANT_A}, 'country_admin') ON CONFLICT DO NOTHING`.execute(
        trx,
      );
    });

  /** Until a session of the admin role waits for a lock, or a few seconds pass (then the test fails on its result). */
  const lockWaited = async () => {
    for (let tries = 0; tries < 100; tries += 1) {
      const { rows } = await sql<{ n: string }>`
        SELECT count(*) AS n FROM pg_stat_activity
         WHERE usename = 'aiontheballot_admin' AND wait_event_type = 'Lock'`.execute(owner);
      if (Number(rows[0]?.n) > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };

  const countryAdminsLeft = async () =>
    (
      await sql<{ user_id: string }>`SELECT user_id FROM app.memberships
                                      WHERE tenant_id = ${TENANT_A} AND role = 'country_admin'`.execute(
        owner,
      )
    ).rows.length;

  /** The first removal holds its transaction open until the second is seen waiting for the lock. */
  const race = async (first: [string, string], second: [string, string]) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const removed = new Promise<void>((resolve) => {
      held = resolve;
    });
    const one = remove(...first, { held, hold });
    await removed;
    const two = remove(...second);
    await lockWaited();
    release();
    return [await one, await two];
  };

  it.each([
    [
      'a platform admin removes both',
      [USERS.platformAdmin, USERS.newcomer],
      [USERS.platformAdmin, USERS.countryAdminA],
    ],
    [
      'two country admins remove each other',
      [USERS.countryAdminA, USERS.newcomer],
      [USERS.newcomer, USERS.countryAdminA],
    ],
  ] as const)(
    'run one after the other when %s, so a country admin is left',
    async (_name, first, second) => {
      await addCountryAdmin(USERS.newcomer);
      try {
        const [one, two] = await race([...first], [...second]);
        expect(one).toBe('removed');
        expect(['last-country-admin', 'not-found']).toContain(two);
        expect(await countryAdminsLeft()).toBe(1);
      } finally {
        await sql`DELETE FROM app.memberships WHERE user_id = ${USERS.newcomer}`.execute(owner);
        await addCountryAdmin(USERS.countryAdminA);
      }
    },
  );
});
