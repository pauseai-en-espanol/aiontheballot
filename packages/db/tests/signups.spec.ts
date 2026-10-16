import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { superuserUrl } from './env.js';
import { SIGNUP_TOKENS, TENANT_A, TENANT_B, TENANT_INACTIVE, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER_VALUE = '22023';
const PROGRAM_LIMIT_EXCEEDED = '54000';

/** The hex SHA-256 of a fictional token, as the API passes it. */
const hash = (token: string) => `encode(sha256(convert_to('${token}', 'UTF8')), 'hex')`;

const signUp = (
  values: Partial<Record<'tenant' | 'email' | 'locale' | 'future' | 'token', string>> = {},
): string => {
  const args = {
    tenant: `'${TENANT_A}'`,
    email: `'  Persona@Example.ORG '`,
    locale: `'es'`,
    future: 'false',
    token: hash('token-de-ejemplo-1'),
    ...values,
  };
  return `SELECT app.sign_up(tenant => ${args.tenant}, email => ${args.email}, locale => ${args.locale},
                             future_elections => ${args.future}, token_hash => ${args.token}) AS send`;
};

const asWeb = async <T>(client: pg.Client, fn: () => Promise<T>): Promise<T> => {
  await client.query('SET LOCAL ROLE aiontheballot_web');
  try {
    return await fn();
  } finally {
    await client.query('RESET ROLE');
  }
};

const send = async (client: pg.Client, sql: string): Promise<boolean> =>
  (await client.query<{ send: boolean }>(sql)).rows[0]!.send;

const call = async (
  client: pg.Client,
  fn: string,
  token: string | null,
  tenant: string | null = TENANT_A,
): Promise<boolean> =>
  (
    await client.query<{ done: boolean }>(
      `SELECT app.${fn}(${tenant === null ? 'NULL' : `'${tenant}'`}, ${token === null ? 'NULL' : hash(token)}) AS done`,
    )
  ).rows[0]!.done;

const signup = async (client: pg.Client, email = 'persona@example.org') =>
  (
    await client.query<Record<string, unknown>>(
      `SELECT email, locale, future_elections, tokens_issued, confirmed_at IS NOT NULL AS confirmed,
              token_hash = ${hash('token-de-ejemplo-1')} AS first_token
         FROM app.signups WHERE tenant_id = $1 AND email = $2`,
      [TENANT_A, email],
    )
  ).rows[0];

/** Moves a signup's clock back, as the owner: its token issued and its creation `age` ago. */
const age = async (client: pg.Client, interval: string, email = 'persona@example.org') => {
  await client.query('ALTER TABLE app.signups DISABLE TRIGGER rules');
  await client.query(
    `UPDATE app.signups SET token_issued_at = token_issued_at - $3::interval,
                            created_at = created_at - $3::interval
      WHERE tenant_id = $1 AND email = $2`,
    [TENANT_A, email, interval],
  );
  await client.query('ALTER TABLE app.signups ENABLE TRIGGER rules');
};

describe('signing up', () => {
  it('records an unconfirmed signup from the public, its address trimmed and lowercased', async () => {
    await inRolledBackTransaction(async (client) => {
      expect(await asWeb(client, () => send(client, signUp({ future: 'true' })))).toBe(true);
      expect(await signup(client)).toEqual({
        email: 'persona@example.org',
        locale: 'es',
        future_elections: true,
        tokens_issued: 1,
        confirmed: false,
        first_token: true,
      });
    });
  });

  it.each([
    ['for an inactive site', { tenant: `'${TENANT_INACTIVE}'` }],
    ['for a site that does not exist', { tenant: `'${USERS.newcomer}'` }],
    ['in a language the site does not offer', { locale: `'en'` }],
  ])('is refused %s', async (_name, values) => {
    expect(await inRolledBackTransaction((c) => asWeb(c, () => errorCode(c, signUp(values))))).toBe(
      INVALID_PARAMETER_VALUE,
    );
  });

  it('is refused while the site has no published privacy policy', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `DELETE FROM app.tenant_documents WHERE tenant_id = $1 AND kind = 'privacy_policy'
           AND published_at IS NOT NULL`,
        [TENANT_A],
      );
      expect(await asWeb(client, () => errorCode(client, signUp()))).toBe(INVALID_PARAMETER_VALUE);
    });
  });

  it('is refused for an address that is not one', async () => {
    expect(
      await inRolledBackTransaction((c) =>
        asWeb(c, () => errorCode(c, signUp({ email: `'no es un correo'` }))),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('sends nothing again within 10 minutes, and keeps the first token', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      const again = signUp({ token: hash('token-de-ejemplo-2'), future: 'true' });
      expect(await asWeb(client, () => send(client, again))).toBe(false);
      expect(await signup(client)).toMatchObject({
        tokens_issued: 1,
        first_token: true,
        future_elections: false,
      });
    });
  });

  it('issues a new token after 10 minutes, with the newest choices, and the old one stops working', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      await age(client, '11 minutes');
      const again = signUp({ token: hash('token-de-ejemplo-2'), future: 'true' });
      expect(await asWeb(client, () => send(client, again))).toBe(true);
      expect(await signup(client)).toMatchObject({
        tokens_issued: 2,
        first_token: false,
        future_elections: true,
      });
      expect(await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'))).toBe(
        false,
      );
      expect(await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-2'))).toBe(
        true,
      );
    });
  });

  it('issues at most 5 tokens to an address', async () => {
    await inRolledBackTransaction(async (client) => {
      for (let n = 1; n <= 5; n += 1) {
        expect(
          await asWeb(client, () => send(client, signUp({ token: hash(`token-de-ejemplo-${n}`) }))),
        ).toBe(true);
        await age(client, '11 minutes');
      }
      expect(
        await asWeb(client, () => send(client, signUp({ token: hash('token-de-ejemplo-6') }))),
      ).toBe(false);
      expect(await signup(client)).toMatchObject({ tokens_issued: 5 });
    });
  });

  it('changes nothing about a confirmed address, which a stranger could otherwise do', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'));
      await age(client, '1 day');
      const again = signUp({ token: hash('token-de-ejemplo-2'), future: 'true', locale: `'es'` });
      expect(await asWeb(client, () => send(client, again))).toBe(false);
      expect(await signup(client)).toMatchObject({
        confirmed: true,
        first_token: true,
        future_elections: false,
        tokens_issued: 1,
      });
    });
  });

  it("stops at the site's daily cap of signups, counting every one, whatever comes of it", async () => {
    await inRolledBackTransaction(async (client) => {
      const today = async () =>
        (
          await client.query<{ count: number }>(
            `SELECT coalesce(sum(count), 0)::int AS count FROM app.signup_daily_counts
              WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`,
            [TENANT_A],
          )
        ).rows[0]!.count;
      const before = await today();
      await asWeb(client, () => send(client, signUp()));
      await age(client, '11 minutes');
      await asWeb(client, () => send(client, signUp({ token: hash('token-de-ejemplo-2') })));
      // One that sends nothing (too soon) counts too: the count says nothing about who is listed.
      await asWeb(client, () => send(client, signUp({ token: hash('token-de-ejemplo-3') })));
      expect(await today()).toBe(before + 3);
      await client.query(
        `UPDATE app.signup_daily_counts SET count = 1000 WHERE tenant_id = $1 AND day = (now() AT TIME ZONE 'UTC')::date`,
        [TENANT_A],
      );
      expect(
        await asWeb(client, () =>
          errorCode(client, signUp({ email: `'otra@example.org'`, token: hash('t3') })),
        ),
      ).toBe(PROGRAM_LIMIT_EXCEEDED);
      // Another site's list is unaffected.
      expect(
        await asWeb(client, () => errorCode(client, signUp({ tenant: `'${TENANT_B}'` }))),
      ).toBeNull();
    });
  });

  it('answers the cap the same for every address, listed or not, so it tells nobody who is listed', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'));
      await client.query(
        `INSERT INTO app.signup_daily_counts (tenant_id, day, count) VALUES ($1, (now() AT TIME ZONE 'UTC')::date, 1000)
         ON CONFLICT (tenant_id, day) DO UPDATE SET count = 1000`,
        [TENANT_A],
      );
      for (const email of ['persona@example.org', 'nadie@example.org']) {
        expect(
          await asWeb(client, () =>
            errorCode(client, signUp({ email: `'${email}'`, token: hash('t9') })),
          ),
          email,
        ).toBe(PROGRAM_LIMIT_EXCEEDED);
      }
    });
  });

  it("counts Gmail's dotted and googlemail.com variants as one mailbox", async () => {
    await inRolledBackTransaction(async (client) => {
      expect(
        await asWeb(client, () =>
          send(client, signUp({ email: `'pers.ona+uno@gmail.com'`, token: hash('g1') })),
        ),
      ).toBe(true);
      for (const [email, token] of [
        ['persona@googlemail.com', 'g2'],
        ['p.e.r.s.o.n.a@gmail.com', 'g3'],
      ]) {
        expect(
          await asWeb(client, () =>
            send(client, signUp({ email: `'${email}'`, token: hash(token) })),
          ),
          email,
        ).toBe(false);
      }
      // Another provider's dots make another mailbox.
      for (const [email, token] of [
        ['pers.ona@example.org', 'g4'],
        ['persona@example.org', 'g5'],
      ]) {
        expect(
          await asWeb(client, () =>
            send(client, signUp({ email: `'${email}'`, token: hash(token) })),
          ),
          email,
        ).toBe(true);
      }
    });
  });

  it("counts a mailbox's +tag variants as one: one email every 10 minutes, 5 in all", async () => {
    await inRolledBackTransaction(async (client) => {
      expect(
        await asWeb(client, () =>
          send(client, signUp({ email: `'buzon+uno@example.org'`, token: hash('v1') })),
        ),
      ).toBe(true);
      expect(
        await asWeb(client, () =>
          send(client, signUp({ email: `'buzon+dos@example.org'`, token: hash('v2') })),
        ),
      ).toBe(false);
      for (let n = 3; n <= 6; n += 1) {
        await client.query('ALTER TABLE app.signups DISABLE TRIGGER rules');
        await client.query(
          `UPDATE app.signups SET token_issued_at = token_issued_at - interval '11 minutes' WHERE mailbox = 'buzon@example.org'`,
        );
        await client.query('ALTER TABLE app.signups ENABLE TRIGGER rules');
        await asWeb(client, () =>
          send(client, signUp({ email: `'buzon+v${n}@example.org'`, token: hash(`v${n}`) })),
        );
      }
      const { rows } = await client.query<{ n: number; issued: number }>(
        `SELECT count(*)::int AS n, sum(tokens_issued)::int AS issued FROM app.signups WHERE mailbox = 'buzon@example.org'`,
      );
      expect(rows).toEqual([{ n: 5, issued: 5 }]);
    });
  });

  it.each(['aiontheballot_admin', 'aiontheballot_worker', 'aiontheballot_auth'])(
    'is not open to %s',
    async (role) => {
      expect(
        await inRolledBackTransaction(async (c) => {
          await c.query(`SET LOCAL ROLE ${role}`);
          return errorCode(c, signUp());
        }),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    },
  );

  it('never puts the address, the mailbox or the token in the audit log', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      const { rows } = await client.query<{ keys: string[] }>(
        `SELECT ARRAY(SELECT jsonb_object_keys(a.diff -> 'new')) AS keys
           FROM app.audit_log a JOIN app.signups s ON s.id::text = a.row_id
          WHERE a.table_name = 'signups' AND s.email = 'persona@example.org'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.keys).toContain('confirmed_at');
      for (const column of ['email', 'mailbox', 'token_hash']) {
        expect(rows[0]!.keys).not.toContain(column);
      }
    });
  });
});

describe('two signups of one new address at once', () => {
  /** Waits until the backend `pid` waits on a lock: only then is it a race. */
  const waitsOnLock = (pid: number | undefined) =>
    expect
      .poll(() =>
        inRolledBackTransaction(async (watcher) => {
          const { rows } = await watcher.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`,
            [pid],
          );
          return rows[0]?.n;
        }),
      )
      .toBe(1);

  it("send one confirmation email: the second waits for the first's turn, then finds the address", async () => {
    const email = `a-la-vez-${Date.now()}@example.org`;
    const first = new pg.Client({ connectionString: superuserUrl() });
    const second = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      await first.query('BEGIN');
      await first.query('SET LOCAL ROLE aiontheballot_web');
      expect(await send(first, signUp({ email: `'${email}'` }))).toBe(true);
      const { rows: backend } = await second.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await second.query('BEGIN');
      await second.query('SET LOCAL ROLE aiontheballot_web');
      const waiting = send(second, signUp({ email: `'${email}'`, token: hash('otro-token') }));
      // Only once the second waits on the first is it a race: then the first commits.
      await waitsOnLock(backend[0]?.pid);
      await first.query('COMMIT');
      expect(await waiting).toBe(false);
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await first.query('DELETE FROM app.signups WHERE email = $1', [email]);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it("across UTC midnight, each holding another day's counter, the second gives way instead of failing", async () => {
    const email = `medianoche-${Date.now()}@example.org`;
    const first = new pg.Client({ connectionString: superuserUrl() });
    const second = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      // The first signup's insert, as the day before's would make it: today's counter stays free.
      await first.query('BEGIN');
      await first.query(
        `INSERT INTO app.signups (tenant_id, email, locale, token_hash)
         VALUES ($1, $2, 'es', ${hash('ayer')})`,
        [TENANT_A, email],
      );
      const { rows: backend } = await second.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await second.query('BEGIN');
      await second.query('SET LOCAL ROLE aiontheballot_web');
      const waiting = send(second, signUp({ email: `'${email}'`, token: hash('hoy') }));
      await waitsOnLock(backend[0]?.pid);
      await first.query('COMMIT');
      expect(await waiting).toBe(false);
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await first.query('DELETE FROM app.signups WHERE email = $1', [email]);
      await Promise.all([first.end(), second.end()]);
    }
  });
});

describe('confirming', () => {
  it('confirms the signup the token belongs to, once, and says so again on a second click', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      expect(await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'))).toBe(
        true,
      );
      const { rows } = await client.query(
        `SELECT confirmed_at = now() AS now FROM app.signups WHERE tenant_id = $1 AND email = 'persona@example.org'`,
        [TENANT_A],
      );
      expect(rows).toEqual([{ now: true }]);
      // A day later, the same link still says it's done, and the confirmation keeps its date.
      await client.query('ALTER TABLE app.signups DISABLE TRIGGER rules');
      await client.query(
        `UPDATE app.signups SET confirmed_at = confirmed_at - interval '1 day' WHERE email = 'persona@example.org'`,
      );
      await client.query('ALTER TABLE app.signups ENABLE TRIGGER rules');
      expect(await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'))).toBe(
        true,
      );
      const { rows: kept } = await client.query(
        `SELECT confirmed_at = now() - interval '1 day' AS kept FROM app.signups WHERE email = 'persona@example.org'`,
      );
      expect(kept).toEqual([{ kept: true }]);
    });
  });

  it('does nothing for a token that is no one’s', async () => {
    expect(
      await inRolledBackTransaction((c) =>
        asWeb(c, () => call(c, 'confirm_signup', 'token-que-no-existe')),
      ),
    ).toBe(false);
  });

  it('deletes signups unconfirmed for 7 days, and only those, on every call (NULL does only that)', async () => {
    await inRolledBackTransaction(async (client) => {
      for (const [email, token] of [
        ['vieja@example.org', 'token-viejo'],
        ['reciente@example.org', 'token-reciente'],
        ['confirmada@example.org', 'token-confirmado'],
      ] as const) {
        await asWeb(client, () =>
          send(client, signUp({ email: `'${email}'`, token: hash(token) })),
        );
      }
      await asWeb(client, () => call(client, 'confirm_signup', 'token-confirmado'));
      await age(client, '7 days', 'vieja@example.org');
      await age(client, '6 days 23 hours', 'reciente@example.org');
      await age(client, '30 days', 'confirmada@example.org');
      expect(await asWeb(client, () => call(client, 'confirm_signup', null, null))).toBe(false);
      const { rows } = await client.query<{ email: string }>(
        `SELECT email FROM app.signups WHERE tenant_id = $1 AND email LIKE '%@example.org'
            AND email IN ('vieja@example.org', 'reciente@example.org', 'confirmada@example.org')
          ORDER BY email`,
        [TENANT_A],
      );
      expect(rows.map((r) => r.email)).toEqual(['confirmada@example.org', 'reciente@example.org']);
    });
  });

  it.each([
    ['app.sign_up', () => signUp({ email: `'otra@example.org'`, token: hash('token-otro') })],
    [
      'app.unsubscribe',
      () => `SELECT app.unsubscribe('${TENANT_A}', ${hash('token-que-no-existe')})`,
    ],
  ])('deletes the expired ones on %s too', async (_name, sql) => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      await age(client, '8 days');
      await asWeb(client, () => client.query(sql()));
      expect(await signup(client)).toBeUndefined();
    });
  });

  it('never arrives confirmed, even from the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(
        `INSERT INTO app.signups (tenant_id, email, locale, token_hash, confirmed_at, tokens_issued)
         VALUES ($1, 'directa@example.org', 'es', repeat('b', 64), now(), 3)`,
        [TENANT_A],
      );
      const { rows } = await client.query(
        `SELECT confirmed_at, tokens_issued FROM app.signups WHERE email = 'directa@example.org'`,
      );
      expect(rows).toEqual([{ confirmed_at: null, tokens_issued: 1 }]);
    });
  });

  it('can never be undone, nor an address changed, even by the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'));
      for (const set of [`confirmed_at = NULL`, `email = 'otra@example.org'`]) {
        expect(
          await errorCode(
            client,
            `UPDATE app.signups SET ${set} WHERE tenant_id = '${TENANT_A}' AND email = 'persona@example.org'`,
          ),
        ).toBe(RESTRICT_VIOLATION);
      }
    });
  });
});

describe('unsubscribing', () => {
  it.each([
    ['a confirmed signup', true],
    ['an unconfirmed one ("this wasn’t me")', false],
  ])('deletes %s', async (_name, confirm) => {
    await inRolledBackTransaction(async (client) => {
      await asWeb(client, () => send(client, signUp()));
      if (confirm) {
        await asWeb(client, () => call(client, 'confirm_signup', 'token-de-ejemplo-1'));
      }
      expect(await asWeb(client, () => call(client, 'unsubscribe', 'token-de-ejemplo-1'))).toBe(
        true,
      );
      expect(await signup(client)).toBeUndefined();
      expect(await asWeb(client, () => call(client, 'unsubscribe', 'token-de-ejemplo-1'))).toBe(
        false,
      );
    });
  });

  it("acts only on its own site's list", async () => {
    await inRolledBackTransaction(async (client) => {
      // B's token, on A's site: nothing, and B's signup stays as it was.
      expect(await asWeb(client, () => call(client, 'unsubscribe', SIGNUP_TOKENS.B))).toBe(false);
      expect(await asWeb(client, () => call(client, 'confirm_signup', SIGNUP_TOKENS.B))).toBe(
        false,
      );
      const { rows: b } = await client.query(
        `SELECT confirmed_at FROM app.signups WHERE tenant_id = $1 AND email LIKE 'suscripcion-%'`,
        [TENANT_B],
      );
      expect(b).toEqual([{ confirmed_at: null }]);
      expect(
        await asWeb(client, () => call(client, 'unsubscribe', SIGNUP_TOKENS.B, TENANT_B)),
      ).toBe(true);
      const { rows } = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM app.signups WHERE email LIKE 'suscripcion-%@example.org' ORDER BY email`,
      );
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A, TENANT_INACTIVE]);
    });
  });
});

describe('counting a list', () => {
  it('shows country admins every column but the address and the token', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
        [USERS.countryAdminA],
      );
      const { rows } = await client.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE confirmed_at IS NULL)::int AS pending
           FROM app.signups`,
      );
      expect(rows).toEqual([{ n: 1, pending: 1 }]);
      expect(await errorCode(client, 'SELECT email FROM app.signups')).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});
