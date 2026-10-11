import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { INVITATION_TOKENS, REVOKED_INVITATION_TOKEN, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';

const byToken = (token: string): string => `token_hash = encode(sha256('${token}'), 'hex')`;
const PENDING_A = byToken(INVITATION_TOKENS.A);
const REVOKED_A = byToken(REVOKED_INVITATION_TOKEN);

const actAs = async (
  client: pg.Client,
  userId: string,
  role = 'aiontheballot_admin',
): Promise<void> => {
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

/** Superuser only: moves a fixture invitation into the past without firing triggers, so it has expired. */
const expire = async (client: pg.Client, where: string): Promise<void> => {
  await client.query(`SET LOCAL session_replication_role = replica`);
  await client.query(
    `UPDATE app.invitations SET created_at = now() - interval '10 days', expires_at = now() - interval '1 day'
      WHERE ${where}`,
  );
  await client.query(`SET LOCAL session_replication_role = origin`);
};

describe('app.invitations checks', () => {
  const insert = (columns: Record<string, string>): string => {
    const values = {
      tenant_id: `'${TENANT_A}'`,
      email: `'persona@example.org'`,
      role: `'editor'`,
      token_hash: `encode(sha256('t'), 'hex')`,
      expires_at: `now() + interval '7 days'`,
      ...columns,
    };
    return `INSERT INTO app.invitations (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
  };

  it.each([
    ['an uppercase email', { email: `'Persona@example.org'` }],
    ['an email without @', { email: `'persona.example.org'` }],
    ['a raw token instead of its hash', { token_hash: `'token-de-prueba'` }],
    ['an expiry in the past', { expires_at: `now() - interval '1 second'` }],
    ['an expiry beyond 30 days', { expires_at: `now() + interval '31 days'` }],
  ])('rejects %s', async (_name, columns) => {
    const code = await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.countryAdminA]);
      return errorCode(client, insert(columns));
    });
    expect(code).toBe(CHECK_VIOLATION);
  });
});

describe('app.invitations transitions', () => {
  it('revokes a pending invitation at the transaction time, whatever time the caller sends', async () => {
    const [row] = await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.countryAdminA);
      await client.query(`UPDATE app.invitations SET revoked_at = '2000-01-01' WHERE ${PENDING_A}`);
      await client.query('RESET ROLE');
      return (
        await client.query(
          `SELECT revoked_at = now() AS now FROM app.invitations WHERE ${PENDING_A}`,
        )
      ).rows;
    });
    expect(row).toEqual({ now: true });
  });

  it('never changes a decided invitation, not even as the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.platformAdmin, 'aiontheballot_owner');
      expect(
        await errorCode(client, `UPDATE app.invitations SET revoked_at = now() WHERE ${REVOKED_A}`),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(client, `UPDATE app.invitations SET revoked_at = NULL WHERE ${REVOKED_A}`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('accepts once, for the current actor and at the transaction time (the M2 function relies on this)', async () => {
    await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.newcomer, 'aiontheballot_owner');
      const { rows } = await client.query(
        `UPDATE app.invitations SET accepted_at = '2000-01-01', accepted_by = $1 WHERE ${PENDING_A}
         RETURNING accepted_by, accepted_at = now() AS now`,
        [USERS.editorA],
      );
      expect(rows).toEqual([{ accepted_by: USERS.newcomer, now: true }]);
      expect(
        await errorCode(
          client,
          `UPDATE app.invitations SET accepted_at = now() WHERE ${PENDING_A}`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(client, `UPDATE app.invitations SET revoked_at = now() WHERE ${PENDING_A}`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('refuses to accept a revoked or expired invitation, or to change anything else while accepting', async () => {
    await inRolledBackTransaction(async (client) => {
      await expire(client, byToken(INVITATION_TOKENS.B));
      await actAs(client, USERS.newcomer, 'aiontheballot_owner');
      const accept = (where: string, extra = ''): Promise<string | null> =>
        errorCode(client, `UPDATE app.invitations SET accepted_at = now()${extra} WHERE ${where}`);
      expect(await accept(REVOKED_A)).toBe(RESTRICT_VIOLATION);
      expect(await accept(byToken(INVITATION_TOKENS.B))).toBe(RESTRICT_VIOLATION);
      expect(await accept(PENDING_A, `, role = 'country_admin'`)).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe('app.invitations retention', () => {
  it('lets a country admin delete an expired invitation, but not a pending one', async () => {
    const deleted = await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.platformAdmin]);
      await client.query(
        `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
         VALUES ($1, 'caducada@example.org', 'editor', encode(sha256('token-caducado'), 'hex'),
                 now() + interval '1 day')`,
        [TENANT_A],
      );
      await expire(client, byToken('token-caducado'));
      await actAs(client, USERS.countryAdminA);
      return [
        (await client.query(`DELETE FROM app.invitations WHERE ${byToken('token-caducado')}`))
          .rowCount,
        (await client.query(`DELETE FROM app.invitations WHERE ${PENDING_A}`)).rowCount,
      ];
    });
    expect(deleted).toEqual([1, 0]);
  });

  it('never copies the email into the audit log', async () => {
    const diffs = await inRolledBackTransaction(async (client) => {
      await actAs(client, USERS.countryAdminA);
      await client.query(
        `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
         VALUES ($1, 'persona-auditada@example.org', 'reviewer', encode(sha256('token-auditado'), 'hex'),
                 now() + interval '7 days')`,
        [TENANT_A],
      );
      await client.query('RESET ROLE');
      return (
        await client.query<{ diff: { new: Record<string, unknown> } }>(
          `SELECT diff FROM app.audit_log WHERE table_name = 'invitations' AND diff -> 'new' ->> 'role' = 'reviewer'`,
        )
      ).rows;
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.diff.new).not.toHaveProperty('email');
    expect(diffs[0]?.diff.new).toHaveProperty('token_hash');
  });
});

describe('accepting an invitation (editorial workflow A3; PLAN R114)', () => {
  const INVITED = '0190f8c4-1a71-7000-8000-0000000000a1';
  const STRANGER = '0190f8c4-1a71-7000-8000-0000000000a2';
  const hashOf = (token: string) => `encode(sha256('${token}'), 'hex')`;

  /** Accounts as Better Auth makes them, as the superuser: the invited email, verified or not, and another one. */
  const accounts = async (client: pg.Client, { verified = true } = {}) => {
    await client.query(
      `INSERT INTO auth.users (id, name, email, email_verified)
       VALUES ($1, 'Persona invitada', 'Persona-Invitada-A@example.org', $3),
              ($2, 'Persona ajena', 'persona-ajena@example.org', true)`,
      [INVITED, STRANGER, verified],
    );
  };

  const pending = async (client: pg.Client, token: string) =>
    (
      await client.query<{ email: string; role: string }>(
        `SELECT email, role FROM private.pending_invitation(${hashOf(token)})`,
      )
    ).rows;

  const accept = async (client: pg.Client, token: string) =>
    (
      await client.query<{ done: boolean }>(
        `SELECT private.accept_invitation(${hashOf(token)}) AS done`,
      )
    ).rows[0]?.done;

  it('names the email and role of a pending invitation, and nothing for any other token', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await pending(client, INVITATION_TOKENS.A)).toEqual([
        { email: 'persona-invitada-a@example.org', role: 'editor' },
      ]);
      expect(await pending(client, REVOKED_INVITATION_TOKEN)).toEqual([]);
      expect(await pending(client, 'un-token-inventado')).toEqual([]);
      await client.query('RESET ROLE');
      await expire(client, PENDING_A);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await pending(client, INVITATION_TOKENS.A)).toEqual([]);
    });
  });

  it('accepts it for the account with the invited email, verified: the membership, once, at aal1', async () => {
    await inRolledBackTransaction(async (client) => {
      await accounts(client);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '1', true)`,
        [INVITED],
      );
      expect(await accept(client, INVITATION_TOKENS.A)).toBe(true);
      expect(await accept(client, INVITATION_TOKENS.A)).toBe(false);
      await client.query('RESET ROLE');
      const { rows } = await client.query(
        `SELECT m.role, i.accepted_by FROM app.memberships m
           JOIN app.invitations i ON i.tenant_id = m.tenant_id AND i.${PENDING_A}
          WHERE m.user_id = $1 AND m.tenant_id = $2`,
        [INVITED, TENANT_A],
      );
      expect(rows).toEqual([{ role: 'editor', accepted_by: INVITED }]);
    });
  });

  it.each([
    ['another account', { actor: STRANGER, verified: true }],
    ['an account whose email is not verified', { actor: INVITED, verified: false }],
    ['nobody', { actor: '', verified: true }],
  ])('accepts nothing for %s', async (_name, { actor, verified }) => {
    await inRolledBackTransaction(async (client) => {
      await accounts(client, { verified });
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [actor]);
      expect(await accept(client, INVITATION_TOKENS.A)).toBe(false);
      expect(await pending(client, INVITATION_TOKENS.A)).toHaveLength(1);
    });
  });

  it('accepts nothing once it is revoked or expired', async () => {
    await inRolledBackTransaction(async (client) => {
      await accounts(client);
      await expire(client, PENDING_A);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [INVITED]);
      expect(await accept(client, INVITATION_TOKENS.A)).toBe(false);
      expect(await accept(client, REVOKED_INVITATION_TOKEN)).toBe(false);
    });
  });

  it.each(['aiontheballot_web', 'aiontheballot_worker', 'aiontheballot_auth'])(
    'is not open to %s',
    async (role) => {
      expect(
        await inRolledBackTransaction(async (client) => {
          await client.query(`SET LOCAL ROLE ${role}`);
          return errorCode(client, `SELECT * FROM private.pending_invitation('x')`);
        }),
      ).toBe('42501');
      expect(
        await inRolledBackTransaction(async (client) => {
          await client.query(`SET LOCAL ROLE ${role}`);
          return errorCode(client, `SELECT private.accept_invitation('x')`);
        }),
      ).toBe('42501');
    },
  );
});
