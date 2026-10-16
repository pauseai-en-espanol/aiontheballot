import type { Locale } from '@aiontheballot/i18n/catalog';

import { createAuthPool } from '@aiontheballot/db/auth-pool';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PasswordMail } from '../src/auth/password-mail.js';

import { buildApp } from '../src/app.js';
import { createAuth, heldBackPasswordLink } from '../src/auth/auth.js';
import { createPasswordLinks, PasswordMailFailed } from '../src/auth/password-links.js';
import {
  ADMIN_ORIGIN,
  browser,
  createAccount,
  deleteAccount,
  limiterAddress,
  PASSWORD,
  SECRET,
  testAddress,
  TOTP_ISSUER,
  totpCode,
} from './auth-fixtures.js';
import './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const pool = createAuthPool({ connectionString: env('TEST_AUTH_DATABASE_URL'), maxConnections: 4 });

/** What the recovery mail was asked to send, and whether the next email fails. */
const links: { email: string; token: string; locale: Locale; by?: unknown }[] = [];
const notices: { email: string; locale: Locale; enrolled?: boolean }[] = [];
const failures: unknown[] = [];
let failNext = false;
const passwordMail: PasswordMail = {
  link: async (message) => {
    if (failNext) {
      failNext = false;
      throw Object.assign(new Error('550 mailbox unavailable for persona@example.org'), {
        code: 'EENVELOPE',
      });
    }
    links.push(message);
  },
  changed: async (message) => {
    notices.push(message);
  },
};

const options = {
  pool,
  secret: SECRET,
  adminOrigin: ADMIN_ORIGIN,
  totpIssuer: TOTP_ISSUER,
  passwordMail,
  onMailError: (error: unknown) => failures.push(error),
};
const app = buildApp({
  admin: { auth: { auth: createAuth(options), adminOrigin: ADMIN_ORIGIN } },
});
const passwordLinks = createPasswordLinks(options);

const accounts: string[] = [];
const addresses: string[] = [];

const account = async () => {
  const created = await createAccount(pool);
  accounts.push(created.id);
  return created;
};

const visitor = (address = testAddress()) => {
  addresses.push(address);
  return browser(app, address);
};
type Visitor = ReturnType<typeof visitor>;

const ask = (who: Visitor, email: string, headers: Record<string, string> = {}) =>
  who.send('POST', '/api/auth/request-password-reset', { email }, headers);

/**
 * An account with its second factor, enrolled through the endpoints as the admin's pages do (only such an account is
 * sent a link), signed in at aal2 in `who`; with its authenticator's URI.
 */
const enrolled = async (who: Visitor = visitor()) => {
  const created = await account();
  expect(
    (
      await who.send('POST', '/api/auth/sign-in/email', {
        email: created.email,
        password: PASSWORD,
      })
    ).statusCode,
  ).toBe(200);
  const enabled = await who.send('POST', '/api/auth/two-factor/enable', { password: PASSWORD });
  const { totpURI } = enabled.json<{ totpURI: string }>();
  expect(
    (await who.send('POST', '/api/auth/two-factor/verify-totp', { code: totpCode(totpURI) }))
      .statusCode,
  ).toBe(200);
  return { ...created, totpURI };
};

/** The links to set a password the account holds, unused. */
const linksOf = async (userId: string) =>
  (
    await pool.query<{ identifier: string }>(
      `SELECT identifier FROM verifications WHERE value = $1 AND expires_at > now() + interval '30 minutes'`,
      [userId],
    )
  ).rows;

/**
 * A link to set a password as Better Auth stores one (its token's hash), stamped `ago` seconds back: what the clock of
 * the process that wrote it said, which needn't follow the order the rows were written in.
 */
const madeLink = async (userId: string, token: string, ago = 0) => {
  await pool.query(
    `INSERT INTO verifications (identifier, value, expires_at, created_at)
     VALUES ($1, $2, now() + interval '1 hour' - make_interval(secs => $3), now() - make_interval(secs => $3))`,
    [createHash('sha256').update(`reset-password:${token}`).digest('base64url'), userId, ago],
  );
};

/** Mail goes out in the background: waits for it, or for long enough to know none is coming. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  for (const id of accounts) {
    await deleteAccount(pool, id);
  }
  for (const address of addresses) {
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1 || '|%' OR key LIKE $2 || '|%'`, [
      address,
      limiterAddress(address),
    ]);
  }
  await app.close();
  await pool.end();
});

describe('"I forgot my password" (editorial workflow A5.2, PLAN R170)', () => {
  it('answers the same whether or not the address has an account, and mails a link only to an account', async () => {
    const { id, email } = await enrolled();
    links.length = 0;
    const known = await ask(visitor(), email.toUpperCase(), {
      'accept-language': 'es-ES,es;q=0.9',
    });
    const unknown = await ask(visitor(), `nadie-${crypto.randomUUID()}@example.org`);
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(known.json()).toEqual(unknown.json());
    await vi.waitFor(() => expect(links).toHaveLength(1));
    await settle();
    expect(links).toEqual([{ email, token: expect.any(String), locale: 'es' }]);
    // Kept only as the token's hash.
    const stored = await linksOf(id);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.identifier).not.toContain(links[0]?.token);
  });

  it("writes in the language chosen with the admin's switch over the browser's", async () => {
    const { email } = await enrolled();
    links.length = 0;
    await ask(visitor(), email, {
      cookie: '__Host-locale=en',
      'accept-language': 'es-ES,es;q=0.9',
    });
    await vi.waitFor(() => expect(links).toHaveLength(1));
    expect(links[0]?.locale).toBe('en');
  });

  it('tells an account with no second factor, whose link the owner gave (D19), that it has none yet', async () => {
    const { id, email } = await account();
    notices.length = 0;
    const token = crypto.randomUUID().replaceAll('-', '').slice(0, 24);
    await madeLink(id, token);
    const reset = await visitor().send(
      'POST',
      '/api/auth/reset-password',
      { token, newPassword: 'otra contraseña de ejemplo' },
      { 'accept-language': 'en' },
    );
    expect(reset.statusCode).toBe(200);
    await vi.waitFor(() => expect(notices).toEqual([{ email, locale: 'en', enrolled: false }]));
  });

  it('sets a new password once: the second factor stays, every session ends, and the account is told', async () => {
    const who = visitor();
    const { id, email } = await enrolled(who);
    expect((await who.send('GET', '/api/session')).json()).toMatchObject({ stage: 'signed-in' });

    links.length = 0;
    notices.length = 0;
    await ask(visitor(), email);
    await vi.waitFor(() => expect(links).toHaveLength(1));
    const token = links[0]?.token ?? '';
    const newPassword = 'otra contraseña de ejemplo';
    const reset = await visitor().send(
      'POST',
      '/api/auth/reset-password',
      { token, newPassword },
      { 'accept-language': 'es' },
    );
    expect(reset.statusCode).toBe(200);
    // Every session ended, the signed-in one included.
    expect((await who.send('GET', '/api/session')).statusCode).toBe(401);
    expect((await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [id])).rows).toEqual([]);
    await vi.waitFor(() => expect(notices).toEqual([{ email, locale: 'es', enrolled: true }]));
    // The second factor is still there, and asked for.
    expect(
      (await pool.query('SELECT 1 FROM two_factors WHERE user_id = $1', [id])).rows,
    ).toHaveLength(1);
    const again = visitor();
    expect(
      (await again.send('POST', '/api/auth/sign-in/email', { email, password: PASSWORD }))
        .statusCode,
    ).toBe(401);
    const signedIn = await again.send('POST', '/api/auth/sign-in/email', {
      email,
      password: newPassword,
    });
    expect(signedIn.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await again.send('GET', '/api/session')).json()).toMatchObject({ stage: 'challenge' });
    // Once.
    const twice = await visitor().send('POST', '/api/auth/reset-password', {
      token,
      newPassword: 'una tercera contraseña de ejemplo',
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('sends an account one link every 15 minutes, and keeps none it did not send', async () => {
    const { id, email } = await enrolled();
    links.length = 0;
    await ask(visitor(), email);
    await vi.waitFor(() => expect(links).toHaveLength(1));
    await ask(visitor(), email);
    await ask(visitor(), email);
    await settle();
    expect(links).toHaveLength(1);
    expect(await linksOf(id)).toHaveLength(1);
    // The link that went out still works.
    const reset = await visitor().send('POST', '/api/auth/reset-password', {
      token: links[0]?.token,
      newPassword: 'otra contraseña de ejemplo',
    });
    expect(reset.statusCode).toBe(200);
  });

  it('forgets a link whose email failed, reporting no address, so the next one goes out', async () => {
    const { id, email } = await enrolled();
    links.length = 0;
    failures.length = 0;
    failNext = true;
    await ask(visitor(), email);
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(await linksOf(id)).toEqual([]);
    await ask(visitor(), email);
    await vi.waitFor(() => expect(links).toHaveLength(1));
  });

  it('sends no link to an account with no second factor yet, which a new password would hand to the mailbox', async () => {
    const { id, email } = await account();
    links.length = 0;
    expect((await ask(visitor(), email)).statusCode).toBe(200);
    await settle();
    expect(links).toEqual([]);
    expect(await linksOf(id)).toEqual([]);
  });

  it('of requests at the same moment, sends exactly one link', async () => {
    const { id, email } = await enrolled();
    links.length = 0;
    await Promise.all([ask(visitor(), email), ask(visitor(), email), ask(visitor(), email)]);
    await vi.waitFor(() => expect(links).toHaveLength(1));
    await settle();
    expect(links).toHaveLength(1);
    expect(await linksOf(id)).toHaveLength(1);
  });

  it("limits how often one visitor asks (Better Auth's limiter)", async () => {
    const who = visitor();
    const answers: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      answers.push((await ask(who, `nadie-${crypto.randomUUID()}@example.org`)).statusCode);
    }
    expect(answers).toEqual([200, 200, 200, 429]);
  });
});

describe('a password reset email from the members page (PLAN R170)', () => {
  const by = { name: 'Persona de ejemplo', site: 'Sitio de ejemplo', locale: 'es' as const };

  it('mails the member a working link, naming who sent it, and refuses another within 15 minutes', async () => {
    const { id, email } = await enrolled();
    links.length = 0;
    expect(await passwordLinks.send(id, by)).toBe('sent');
    expect(links).toEqual([{ email, token: expect.any(String), locale: 'es', by }]);
    expect(await passwordLinks.send(id, by)).toBe('too-soon');
    expect(links).toHaveLength(1);
    const reset = await visitor().send('POST', '/api/auth/reset-password', {
      token: links[0]?.token,
      newPassword: 'otra contraseña de ejemplo',
    });
    expect(reset.statusCode).toBe(200);
    // A spent link holds nothing back.
    expect(await passwordLinks.send(id, by)).toBe('sent');
  });

  it('answers no-account for an account that is gone, and not-enrolled for one with no second factor', async () => {
    expect(await passwordLinks.send(crypto.randomUUID(), by)).toBe('no-account');
    const { id } = await account();
    links.length = 0;
    expect(await passwordLinks.send(id, by)).toBe('not-enrolled');
    expect(links).toEqual([]);
    expect(await linksOf(id)).toEqual([]);
  });

  it('of two sends at the same moment, mails one link', async () => {
    const { id } = await enrolled();
    links.length = 0;
    const results = await Promise.all([passwordLinks.send(id, by), passwordLinks.send(id, by)]);
    expect(results.sort()).toEqual(['sent', 'too-soon']);
    expect(links).toHaveLength(1);
    expect(await linksOf(id)).toHaveLength(1);
  });

  it('holds back a link written after another went through, whatever their clocks say', async () => {
    const { id } = await enrolled();
    const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
    await madeLink(id, first);
    expect(await heldBackPasswordLink(pool, id, first)).toBe(false);
    // Written second but stamped a second earlier, as by another API replica whose send began first.
    await madeLink(id, second, 1);
    expect(await heldBackPasswordLink(pool, id, second)).toBe(true);
    expect(await linksOf(id)).toHaveLength(1);
  });

  // Guards the turn the checks take on the account's row: without it, two overlapping checks could each see the
  // other's link and both be held back, mailing none.
  it('of two links checked at the same moment, lets exactly one through', async () => {
    const { id } = await enrolled();
    const [one, other] = [crypto.randomUUID(), crypto.randomUUID()];
    await madeLink(id, one);
    await madeLink(id, other);
    const held = await Promise.all([
      heldBackPasswordLink(pool, id, one),
      heldBackPasswordLink(pool, id, other),
    ]);
    expect(held.sort()).toEqual([false, true]);
    expect(await linksOf(id)).toHaveLength(1);
  });

  it("holds back a link written while the owner reset the account's authenticator", async () => {
    // Its sender saw the factor; the reset (as resetAuthenticator: the account's row locked, its factor off, its links
    // forgotten) had none to forget yet when the link was written (ADR-0002 §10). The check waits for the reset's turn
    // on the account's row, then finds the factor gone.
    const { id } = await enrolled();
    const token = crypto.randomUUID();
    const reset = await pool.connect();
    try {
      await reset.query('BEGIN');
      await reset.query('UPDATE users SET two_factor_enabled = false WHERE id = $1', [id]);
      await madeLink(id, token);
      const checked = heldBackPasswordLink(pool, id, token);
      // Long enough for the check to be waiting on the row; it holds back either way.
      await new Promise((resolve) => setTimeout(resolve, 100));
      await reset.query('COMMIT');
      expect(await checked).toBe(true);
    } finally {
      reset.release();
    }
    expect(await linksOf(id)).toEqual([]);
  });

  it('forgets a link whose email failed, and says so without the address', async () => {
    const { id } = await enrolled();
    failNext = true;
    const failed = passwordLinks.send(id, by);
    await expect(failed).rejects.toBeInstanceOf(PasswordMailFailed);
    await expect(failed).rejects.toThrow('An email could not be sent: EENVELOPE');
    expect(await linksOf(id)).toEqual([]);
  });
});
