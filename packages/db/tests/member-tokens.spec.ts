import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { superuserUrl } from './env.js';
import { CELLS, CORE_CRITERION, ELECTIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

/** A fictional token's SHA-256 (only the hash is stored), different per call. */
const tokenHash = (): string =>
  crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');

interface Account {
  user: string;
  session: string;
  /** Another fictional account, for what must never move a token to it. */
  other?: string;
}

/**
 * A fictional account with a password, a second factor and a session, written as `client` (the superuser): `aal` is
 * the session's, `expires` when it ends (from now), `factor` whether the second factor stays and `verified` whether
 * it was verified.
 */
const account = async (
  client: pg.Client,
  { aal = 2, expires = '1 hour', factor = true, verified = true } = {},
): Promise<Account> => {
  const user = crypto.randomUUID();
  await client.query(
    `INSERT INTO auth.users (id, name, email, email_verified, two_factor_enabled)
     VALUES ($1, 'Persona de ejemplo', $2, true, true)`,
    [user, `persona-${user}@example.org`],
  );
  await client.query(
    `INSERT INTO auth.accounts (account_id, provider_id, user_id, password, updated_at)
     VALUES ($1::text, 'credential', $1::uuid, 'hash-de-ejemplo', now())`,
    [user],
  );
  await client.query(
    `INSERT INTO auth.two_factors (secret, backup_codes, user_id, verified) VALUES ('secreto', '[]', $1, true)`,
    [user],
  );
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO auth.sessions (expires_at, token, updated_at, user_id, aal)
     VALUES (now() + $2::interval, $3, now(), $1, $4) RETURNING id`,
    [user, expires, `sesion-${user}`, aal],
  );
  if (!factor) {
    await client.query('DELETE FROM auth.two_factors WHERE user_id = $1', [user]);
  } else if (!verified) {
    await client.query('UPDATE auth.two_factors SET verified = false WHERE user_id = $1', [user]);
  }
  return { user, session: rows[0]!.id };
};

/** The superuser's work in `setup`, then Better Auth's role, which the API mints and checks tokens as. */
const asAuth = <T>(
  setup: (client: pg.Client) => Promise<Account>,
  fn: (client: pg.Client, account: Account) => Promise<T>,
): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    const made = await setup(client);
    await client.query('SET LOCAL ROLE aiontheballot_auth');
    return fn(client, made);
  });

const mintSql = (
  { user, session }: Account,
  {
    expires = `now() + interval '30 days'`,
    hash = `'${tokenHash()}'`,
    name = `'Herramienta de ejemplo'`,
  } = {},
): string =>
  `INSERT INTO auth.member_tokens (user_id, session_id, name, token_hash, expires_at)
   VALUES ('${user}', '${session}', ${name}, ${hash}, ${expires}) RETURNING id`;

const mint = async (client: pg.Client | pg.PoolClient, made: Account): Promise<string> =>
  (await client.query<{ id: string }>(mintSql(made))).rows[0]!.id;

const revoked = async (client: pg.Client, token: string): Promise<boolean> =>
  (
    await client.query<{ revoked: boolean }>(
      'SELECT revoked_at IS NOT NULL AS revoked FROM auth.member_tokens WHERE id = $1',
      [token],
    )
  ).rows[0]!.revoked;

const sessions = async (client: pg.Client, user: string): Promise<number> =>
  (
    await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM auth.sessions WHERE user_id = $1',
      [user],
    )
  ).rows[0]!.count;

describe("a member's token (auth.member_tokens, ADR-0008)", () => {
  it('is minted from a live session of its owner with a second factor, dated by the database, unused', async () => {
    await asAuth(account, async (client, made) => {
      const { rows } = await client.query(
        `${mintSql(made)}, created_at = now() AS dated, last_used_at, revoked_at`,
      );
      expect(rows[0]).toMatchObject({ dated: true, last_used_at: null, revoked_at: null });
    });
  });

  it.each([
    ['a session a password alone opened', (c: pg.Client) => account(c, { aal: 1 })],
    ['a session that has ended', (c: pg.Client) => account(c, { expires: '-1 minute' })],
    ['an account whose second factor is gone', (c: pg.Client) => account(c, { factor: false })],
    [
      'an account whose second factor was never verified',
      (c: pg.Client) => account(c, { verified: false }),
    ],
    [
      "another account's session",
      async (c: pg.Client) => ({ ...(await account(c)), session: (await account(c)).session }),
    ],
    [
      'a session that never existed',
      async (c: pg.Client) => ({ ...(await account(c)), session: crypto.randomUUID() }),
    ],
  ])('is never minted from %s', async (_, setup) => {
    expect(await asAuth(setup, (client, made) => errorCode(client, mintSql(made)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('lasts 30 days at most, counted from when the database says it was minted', async () => {
    await asAuth(account, async (client, made) => {
      expect(
        await errorCode(client, mintSql(made, { expires: `now() + interval '30 days 1 minute'` })),
      ).toBe(CHECK_VIOLATION);
      expect(await errorCode(client, mintSql(made, { expires: 'now()' }))).toBe(CHECK_VIOLATION);
      // A minting date in the past would make a token look older than it is, within the 30 days or past them: the
      // database dates it itself.
      expect(
        await errorCode(
          client,
          `INSERT INTO auth.member_tokens (user_id, session_id, name, token_hash, created_at, expires_at)
           VALUES ('${made.user}', '${made.session}', 'Herramienta', '${tokenHash()}', now() - interval '10 days',
                   now() + interval '15 days')`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('keeps only a SHA-256 of the token, once, and a name', async () => {
    await asAuth(account, async (client, made) => {
      expect(await errorCode(client, mintSql(made, { hash: `'mi-token-en-claro'` }))).toBe(
        CHECK_VIOLATION,
      );
      expect(await errorCode(client, mintSql(made, { name: `'  '` }))).toBe(CHECK_VIOLATION);
      const hash = `'${tokenHash()}'`;
      await client.query(mintSql(made, { hash }));
      expect(await errorCode(client, mintSql(made, { hash }))).toBe('23505');
    });
  });

  it('changes only when it was last used and when it was revoked, and a revocation is never undone', async () => {
    const twoAccounts = async (c: pg.Client) => ({
      ...(await account(c)),
      other: (await account(c)).user,
    });
    await asAuth(twoAccounts, async (client, made) => {
      const token = await mint(client, made);
      await client.query('UPDATE auth.member_tokens SET last_used_at = now() WHERE id = $1', [
        token,
      ]);
      for (const set of [
        `name = 'Otro nombre'`,
        `token_hash = '${tokenHash()}'`,
        `expires_at = expires_at + interval '1 day'`,
        `user_id = '${made.other}'`,
      ]) {
        expect(
          await errorCode(client, `UPDATE auth.member_tokens SET ${set} WHERE id = '${token}'`),
          set,
        ).toBe(INSUFFICIENT_PRIVILEGE);
      }
      await client.query('UPDATE auth.member_tokens SET revoked_at = now() WHERE id = $1', [token]);
      expect(
        await errorCode(
          client,
          `UPDATE auth.member_tokens SET revoked_at = NULL WHERE id = '${token}'`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("stamps when it was last used and when it was revoked with the database's clock", async () => {
    await asAuth(account, async (client, made) => {
      const token = await mint(client, made);
      const { rows } = await client.query(
        `UPDATE auth.member_tokens
            SET last_used_at = now() - interval '1 year', revoked_at = now() + interval '1 year'
          WHERE id = $1
         RETURNING last_used_at = now() AS used_now, revoked_at = now() AS revoked_now`,
        [token],
      );
      expect(rows[0]).toEqual({ used_now: true, revoked_now: true });
    });
  });

  it("keeps its name, hash, dates and member even against the owner's scripts, which no grant holds back", async () => {
    await inRolledBackTransaction(async (client) => {
      const made = await account(client);
      const other = (await account(client)).user;
      const token = await mint(client, made);
      for (const set of [
        `name = 'Otro nombre'`,
        `token_hash = '${tokenHash()}'`,
        `expires_at = expires_at + interval '1 day'`,
        `created_at = created_at - interval '1 day'`,
        `session_id = '${crypto.randomUUID()}'`,
        `user_id = '${other}'`,
      ]) {
        expect(
          await errorCode(client, `UPDATE auth.member_tokens SET ${set} WHERE id = '${token}'`),
          set,
        ).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("is never deleted by Better Auth's role: a revoked token stays, as history", async () => {
    await asAuth(account, async (client, made) => {
      const token = await mint(client, made);
      expect(await errorCode(client, `DELETE FROM auth.member_tokens WHERE id = '${token}'`)).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it.each([
    ['its second factor is removed', 'DELETE FROM auth.two_factors WHERE user_id = $1', 0],
    [
      'its second factor is enrolled again (inside a session, which stays)',
      `UPDATE auth.two_factors SET secret = 'otro' WHERE user_id = $1`,
      1,
    ],
    [
      'its password changes',
      `UPDATE auth.accounts SET password = 'otro-hash' WHERE user_id = $1`,
      0,
    ],
    [
      'a password is added',
      `INSERT INTO auth.accounts (account_id, provider_id, user_id, password, updated_at)
       VALUES ('otra', 'otro-proveedor', $1, 'hash-de-ejemplo', now())`,
      0,
    ],
    ['its password is removed', 'DELETE FROM auth.accounts WHERE user_id = $1', 0],
  ])(
    'is revoked with every other token of its owner when %s, which ends their sessions',
    async (_, change, left) => {
      await asAuth(account, async (client, made) => {
        const first = await mint(client, made);
        const second = await mint(client, made);
        await client.query(change, [made.user]);
        expect([await revoked(client, first), await revoked(client, second)]).toEqual([true, true]);
        expect(await sessions(client, made.user)).toBe(left);
      });
    },
  );

  it('outlives the session that minted it, and signing out', async () => {
    await asAuth(account, async (client, made) => {
      const token = await mint(client, made);
      await client.query('DELETE FROM auth.sessions WHERE id = $1', [made.session]);
      expect(await revoked(client, token)).toBe(false);
    });
  });

  /**
   * Two transactions on their own connections over a committed fictional account: `first` runs, then `second` starts
   * and must be seen waiting for a lock before `first` commits. What `second` gives, and the account's id. The account
   * is deleted after.
   */
  const race = async <T>(
    first: (client: pg.Client, made: Account) => Promise<unknown>,
    second: (client: pg.Client, made: Account) => Promise<T>,
    waiting: string,
  ): Promise<{
    outcome: T | { code: string };
    made: Account;
    setup: pg.Client;
    end: () => Promise<void>;
  }> => {
    const setup = new pg.Client({ connectionString: superuserUrl() });
    const one = new pg.Client({ connectionString: superuserUrl() });
    const two = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([setup.connect(), one.connect(), two.connect()]);
    const made = await account(setup);
    const end = async () => {
      await one.query('ROLLBACK').catch(() => undefined);
      await two.query('ROLLBACK').catch(() => undefined);
      await setup.query('DELETE FROM auth.users WHERE id = $1', [made.user]);
      await Promise.all([setup.end(), one.end(), two.end()]);
    };
    try {
      await one.query('BEGIN');
      await first(one, made);
      await two.query('BEGIN');
      const pending = second(two, made).then(
        (value) => value as T | { code: string },
        (error: { code: string }) => ({ code: error.code }),
      );
      let seen = false;
      for (let tries = 0; tries < 100 && !seen; tries += 1) {
        const { rows } = await setup.query<{ waiting: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
                           WHERE wait_event_type = 'Lock' AND query LIKE $1) AS waiting`,
          [`${waiting}%`],
        );
        seen = rows[0]!.waiting;
        if (!seen) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(seen, 'the second transaction waits for the first').toBe(true);
      await one.query('COMMIT');
      const outcome = await pending;
      await two.query('COMMIT').catch(() => undefined);
      return { outcome, made, setup, end };
    } catch (error) {
      await end();
      throw error;
    }
  };

  const changePassword = (client: pg.Client, { user }: Account) =>
    client.query(`UPDATE auth.accounts SET password = 'otro-hash' WHERE user_id = $1`, [user]);
  const mintAsAuth = async (client: pg.Client, made: Account) => {
    await client.query('SET LOCAL ROLE aiontheballot_auth');
    return mint(client, made);
  };

  it('is revoked by a password change that waits for it to be minted, never left behind', async () => {
    let token = '';
    const { outcome, setup, end } = await race(
      async (client, made) => {
        token = await mintAsAuth(client, made);
      },
      changePassword,
      'UPDATE auth.accounts SET password',
    );
    try {
      expect(outcome).not.toHaveProperty('code');
      expect(await revoked(setup, token)).toBe(true);
    } finally {
      await end();
    }
  });

  it('is never minted, while a password change is under way, from a session that change ends', async () => {
    const { outcome, end } = await race(
      changePassword,
      mintAsAuth,
      'INSERT INTO auth.member_tokens',
    );
    try {
      expect(outcome).toEqual({ code: INSUFFICIENT_PRIVILEGE });
    } finally {
      await end();
    }
  });

  it("is out of the admin's reach", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      expect(await errorCode(client, 'SELECT 1 FROM auth.member_tokens')).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

const A = CELLS.A;
const live = ELECTIONS.liveA;
const draft = ELECTIONS.draftA;
const TOKEN = '0190f8c4-0000-7000-8000-0000000000f1';

/** Sets or clears the request's token, as the API does per transaction. */
const setToken = (client: pg.Client, token: boolean): Promise<unknown> =>
  client.query(`SELECT set_config('app.token_id', $1, true)`, [token ? TOKEN : '']);

/**
 * As `userId` through the admin role, in a transaction that is rolled back; with `token`, through one of their tokens
 * (`app.token_id`), as the API sets it for a request that carries one.
 */
const actingAs = <T>(
  userId: string,
  token: boolean,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    await setToken(client, token);
    return fn(client);
  });

/** What `fn` does as the member in the admin, whatever the request after it carries. */
const asPerson = async <T>(client: pg.Client, fn: () => Promise<T>): Promise<T> => {
  const { rows } = await client.query<{ token: string }>(
    `SELECT coalesce(current_setting('app.token_id', true), '') AS token`,
  );
  await setToken(client, false);
  const result = await fn();
  await client.query(`SELECT set_config('app.token_id', $1, true)`, [rows[0]!.token]);
  return result;
};

/** The SQLSTATE and message `sql` failed with, or null. */
const refusal = async (
  client: pg.Client,
  sql: string,
): Promise<{ code: string; message: string } | null> => {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql);
    await client.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    const { code, message } = error as { code: string; message: string };
    return { code, message };
  }
};

const NOTE = `'{"es": "Nota pública de ejemplo"}'`;
// A change starts pending: the admin role has no grant on its state.
const proposal = (): string =>
  `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                    public_note)
   VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${live.secondParty}', 'short_name', '{"es": "PE-B"}',
           ${NOTE}) RETURNING id`;

const proposedByAPerson = (client: pg.Client): Promise<string> =>
  asPerson(client, async () => (await client.query<{ id: string }>(proposal())).rows[0]!.id);

/**
 * Decisions a person takes, never a tool through their token, each as who may take it: what the refusal names, and
 * the statement (after anything a person does first).
 */
type Decision = readonly [string, string, string, (client: pg.Client) => Promise<string>];

const PEOPLE_ONLY: readonly Decision[] = [
  [
    'publish a cell',
    USERS.reviewerA,
    'change assessment_revisions',
    async () =>
      `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
       SELECT id, content_version FROM app.assessments WHERE id = '${A.review}'`,
  ],
  [
    'comment on a cell in review (and so reject it)',
    USERS.reviewerA,
    'change review_events',
    async () =>
      `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
       VALUES ('${TENANT_A}', '${A.review}', 'commented', 'Falta una cita del programa')`,
  ],
  [
    'reject a cell in review',
    USERS.reviewerA,
    'change assessments',
    async (client) => {
      await asPerson(client, () =>
        client.query(
          `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
           VALUES ($1, $2, 'commented', 'Falta una cita del programa')`,
          [TENANT_A, A.review],
        ),
      );
      return `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`;
    },
  ],
  [
    'approve a proposed change',
    USERS.countryAdminA,
    'decide on a change',
    async (client) =>
      `UPDATE app.change_requests SET state = 'approved' WHERE id = '${await proposedByAPerson(client)}'`,
  ],
  [
    'reject a proposed change',
    USERS.countryAdminA,
    'decide on a change',
    async (client) =>
      `UPDATE app.change_requests SET state = 'rejected' WHERE id = '${await proposedByAPerson(client)}'`,
  ],
  ...(
    [
      ['status', `status = 'preview'`, draft.id, USERS.countryAdminA],
      ['announcement', 'announced = NOT announced', draft.id, USERS.countryAdminA],
      ['freeze', `frozen_from = now() + interval '1 day'`, live.id, USERS.countryAdminA],
      [
        'end of its freeze',
        `frozen_from = now() + interval '1 day', frozen_until = now() + interval '2 days'`,
        live.id,
        USERS.countryAdminA,
      ],
      [
        'second-reviewer rule',
        'require_second_reviewer = NOT require_second_reviewer',
        draft.id,
        USERS.platformAdmin,
      ],
    ] as const
  ).map(([what, set, id, who]): Decision => [
    `change an election's ${what}`,
    who,
    'change when or whether an election is shown or reviewed',
    async (client: pg.Client) => {
      if (what === 'end of its freeze') {
        // Frozen by a person first, so only its end changes through the token.
        await asPerson(client, () =>
          client.query(
            `UPDATE app.elections SET frozen_from = now() + interval '1 day' WHERE id = $1`,
            [id],
          ),
        );
        return `UPDATE app.elections SET frozen_until = now() + interval '2 days' WHERE id = '${id}'`;
      }
      return `UPDATE app.elections SET ${set} WHERE id = '${id}'`;
    },
  ]),
  [
    'delete an election',
    USERS.countryAdminA,
    'delete an election',
    async () => `DELETE FROM app.elections WHERE id = '${ELECTIONS.emptyA.id}'`,
  ],
  [
    "mark a party's programme published",
    USERS.editorA,
    "change whether a party's programme is published",
    async () => `UPDATE app.parties SET programme_status = 'published' WHERE id = '${live.party}'`,
  ],
  [
    'open a site to the public',
    USERS.platformAdmin,
    'change tenants',
    async () => `UPDATE app.tenants SET site_open = NOT site_open WHERE id = '${TENANT_B}'`,
  ],
  [
    'rename an election announced on the coming-soon page',
    USERS.countryAdminA,
    'change an election the public sees',
    async () =>
      `UPDATE app.elections SET name = '{"es": "Autonómicas de ejemplo bis"}' WHERE id = '${draft.id}'`,
  ],
  [
    "store a source's copy",
    USERS.editorA,
    'store this file',
    async () =>
      `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
       VALUES ('${TENANT_A}', 'sources', 'application/pdf', 4,
               encode(sha256(convert_to('copia de ejemplo', 'UTF8')), 'hex'))`,
  ],
  [
    'withdraw a change someone else proposed',
    USERS.countryAdminA,
    "withdraw someone else's change",
    async (client) => {
      const id = await asPerson(client, async () => {
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.editorA]);
        const proposed = (await client.query<{ id: string }>(proposal())).rows[0]!.id;
        await client.query(`SELECT set_config('app.user_id', $1, true)`, [USERS.countryAdminA]);
        return proposed;
      });
      return `DELETE FROM app.change_requests WHERE id = '${id}'`;
    },
  ],
  [
    'delete a criterion',
    USERS.countryAdminA,
    'delete criteria',
    async () => `DELETE FROM app.criteria WHERE id = '${draft.secondCriterion}'`,
  ],
  [
    'link a criterion to a core criterion',
    USERS.countryAdminA,
    'link a criterion to a core criterion',
    async () =>
      `UPDATE app.criteria SET core_criterion_id = '${CORE_CRITERION}' WHERE id = '${draft.criterion}'`,
  ],
  [
    'unlink a criterion from its core criterion',
    USERS.countryAdminA,
    'link a criterion to a core criterion',
    async (client) => {
      await asPerson(client, () =>
        client.query(`UPDATE app.criteria SET core_criterion_id = $1 WHERE id = $2`, [
          CORE_CRITERION,
          draft.criterion,
        ]),
      );
      return `UPDATE app.criteria SET core_criterion_id = NULL WHERE id = '${draft.criterion}'`;
    },
  ],
  [
    "propose a change to a live election's criterion",
    USERS.countryAdminA,
    'propose a change to criteria or the methodology',
    async () =>
      `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                        public_note)
       VALUES ('${TENANT_A}', '${live.id}', 'update', 'criterion', '${live.criterion}', 'title',
               '{"es": "Criterio de ejemplo bis"}', ${NOTE})`,
  ],
  [
    'add a criterion linked to a core criterion',
    USERS.countryAdminA,
    'link a criterion to a core criterion',
    async () =>
      `INSERT INTO app.criteria (tenant_id, election_id, slug, title, description, display_order, core_criterion_id)
       VALUES ('${TENANT_A}', '${draft.id}', 'criterio-enlazado', '{"es": "Criterio enlazado de ejemplo"}',
               '{"es": "Descripción de ejemplo"}', 99, '${CORE_CRITERION}')`,
  ],
  [
    "remove someone's role",
    USERS.countryAdminA,
    'change memberships',
    async () =>
      `DELETE FROM app.memberships WHERE user_id = '${USERS.reviewerA}' AND tenant_id = '${TENANT_A}'`,
  ],
];

describe('what a token may never do, whatever its member may (private.needs_a_person, ADR-0008)', () => {
  it.each(PEOPLE_ONLY)('%s', async (_, who, names, prepare) => {
    // The same statement, by the same member, goes through without a token: the token is what's refused, by name.
    expect(await actingAs(who, false, async (c) => refusal(c, await prepare(c)))).toBeNull();
    expect(await actingAs(who, true, async (c) => refusal(c, await prepare(c)))).toEqual({
      code: INSUFFICIENT_PRIVILEGE,
      message: `a member's token can't ${names}: a person does it in the admin`,
    });
  });

  it('refuses every table but those drafting needs, whatever it is written: a new table too, until listed', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ table: string; guard: string | null }>(
        `SELECT c.relname AS table,
                (SELECT string_agg(pg_get_triggerdef(t.oid), ' | ' ORDER BY t.tgname)
                   FROM pg_trigger t
                  WHERE t.tgrelid = c.oid AND t.tgfoid = 'private.needs_a_person'::regproc) AS guard
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
          ORDER BY 1`,
      );
      const drafting: Record<string, string | null> = {
        // What the database writes itself for what a token may do.
        audit_log: null,
        public_versions: null,
        // A logo's bytes, never anything else.
        files: 'BEFORE INSERT',
        // Proposing and withdrawing, never deciding.
        change_requests: 'BEFORE UPDATE OF state',
        // An election's own details, never its visibility or review, nor deleting it.
        elections: 'BEFORE DELETE',
        // Its parties, never their programme's status.
        parties: 'BEFORE UPDATE',
        // Its criteria, in words a person approved, never deleting one or linking it to a core criterion (R213).
        criteria: 'BEFORE DELETE',
      };
      for (const { table, guard } of rows) {
        if (table in drafting) {
          const partial = drafting[table];
          if (partial === null) {
            expect(guard, table).toBeNull();
          } else {
            expect(guard, table).toContain(partial);
          }
        } else {
          expect(guard, table).toContain('BEFORE INSERT OR DELETE OR UPDATE');
          expect(guard, table).toContain(`needs_a_person('change ${table}')`);
        }
      }
    });
  });

  it('drafts: an election, its details, its parties and their logos, its criteria, and changes proposed to a live one', async () => {
    await actingAs(USERS.countryAdminA, true, async (client) => {
      for (const statement of [
        `INSERT INTO app.elections (tenant_id, slug, type, name)
         VALUES ('${TENANT_A}', 'elecciones-de-prueba', 'other', '{"es": "Elecciones de prueba"}')`,
        `UPDATE app.elections SET name = '{"es": "Municipales de ejemplo bis"}' WHERE id = '${ELECTIONS.emptyA.id}'`,
        `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
         VALUES ('${TENANT_A}', '${draft.id}', 'partido-nuevo', '{"es": "Partido Nuevo de Ejemplo"}',
                 '{"es": "PNE"}', 99)`,
        `UPDATE app.parties SET colour = '#123456' WHERE id = '${draft.party}'`,
        `INSERT INTO app.criteria (tenant_id, election_id, slug, title, short_title, description, display_order)
         VALUES ('${TENANT_A}', '${draft.id}', 'criterio-nuevo', '{"es": "Criterio nuevo de ejemplo"}',
                 '{"es": "Nuevo"}', '{"es": "Descripción de ejemplo"}', 99)`,
        `UPDATE app.criteria SET title = '{"es": "Criterio de ejemplo bis"}' WHERE id = '${draft.criterion}'`,
        `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
         VALUES ('${TENANT_A}', 'public_assets', 'image/png', 4,
                 encode(sha256(convert_to('logo de ejemplo', 'UTF8')), 'hex'))`,
      ]) {
        expect(await refusal(client, statement), statement).toBeNull();
      }
      const proposed = (await client.query<{ id: string }>(proposal())).rows[0]!.id;
      expect(
        await refusal(client, `DELETE FROM app.change_requests WHERE id = '${proposed}'`),
      ).toBeNull();
    });
  });
});

describe('the audit log, for what a token wrote (ADR-0008)', () => {
  const lastAudit = async (client: pg.Client) =>
    (
      await client.query<{ actor_id: string; token_id: string | null }>(
        `SELECT actor_id, token_id FROM app.audit_log
          WHERE table_name = 'elections' AND row_id = $1 ORDER BY id DESC LIMIT 1`,
        [ELECTIONS.emptyA.id],
      )
    ).rows[0];
  // An election the public doesn't see yet: neither announced nor live.
  const rename = `UPDATE app.elections SET name = '{"es": "Municipales de ejemplo bis"}' WHERE id = '${ELECTIONS.emptyA.id}'`;

  it('names the token beside its member, by its id only', async () => {
    await actingAs(USERS.countryAdminA, true, async (client) => {
      await client.query(rename);
      expect(await lastAudit(client)).toEqual({
        actor_id: USERS.countryAdminA,
        token_id: TOKEN,
      });
    });
  });

  it('names none for what a member did in the admin', async () => {
    await actingAs(USERS.countryAdminA, false, async (client) => {
      await client.query(rename);
      expect(await lastAudit(client)).toEqual({ actor_id: USERS.countryAdminA, token_id: null });
    });
  });
});
