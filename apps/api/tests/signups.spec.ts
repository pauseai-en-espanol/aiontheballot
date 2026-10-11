import type { DB } from '@aiontheballot/db/generated/db';

import { createDatabase } from '@aiontheballot/db/client';
import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import type { Mailer } from '../src/mail/mailer.js';

import {
  confirmSignup,
  createSignups,
  type PendingEmail,
  sendOrUndo,
  signUp,
  type SignupInput,
  unsubscribe,
} from '../src/signups.js';
import { inRolledBackTransaction } from './db.js';
import { TENANT_A, USERS } from './fixtures.js';

const asPublic = (trx: Transaction<DB>) => sql`SET LOCAL ROLE aiontheballot_web`.execute(trx);
const asSuperuser = (trx: Transaction<DB>) => sql`RESET ROLE`.execute(trx);

const INPUT: SignupInput = {
  email: '  Persona@Example.ORG ',
  locale: 'es',
  futureElections: false,
};
const NO_PLATFORM = { platformHost: undefined };

/** The email a signup leaves to send, or a failure if it leaves none. */
const emailOf = (result: Awaited<ReturnType<typeof signUp>>): PendingEmail => {
  if (result.outcome !== 'accepted' || !result.email) {
    throw new Error(`No email to send (${result.outcome})`);
  }
  return result.email;
};

/** The token in a link of the email: what the person clicks. */
const tokenIn = (text: string, path: string): string => {
  const match = new RegExp(`${path}\\?t=([\\w-]{43})`, 'u').exec(text);
  if (!match?.[1]) {
    throw new Error(`No ${path} link in the email`);
  }
  return match[1];
};

describe('signing up', () => {
  it("leaves a confirmation to send in the operator's name, its links on the site's canonical address", async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const pending = emailOf(
        await signUp(trx, 'test-a', { ...INPUT, futureElections: true }, NO_PLATFORM),
      );
      expect(pending.tenantId).toBe(TENANT_A);
      const { message } = pending;
      expect(message).toMatchObject({
        to: 'persona@example.org',
        fromName: 'Organización de ejemplo A',
        subject: 'Confirma que quieres saber cuándo estará listo Inquilino de prueba A',
      });
      const token = tokenIn(message.text, 'https://test-a.example.test/avisos/confirmar');
      expect(token).toBe(pending.token);
      expect(message.text).toContain(`https://test-a.example.test/avisos/baja?t=${token}`);
      expect(message.text).toContain('https://test-a.example.test/privacidad');
      expect(message.text).toContain('y de futuras elecciones en él');
      expect(message.unsubscribeUrl).toBe(
        `https://test-a.example.test/avisos?action=unsubscribe&t=${token}`,
      );

      expect(await confirmSignup(trx, TENANT_A, token)).toBe(true);
      expect(await unsubscribe(trx, TENANT_A, token)).toBe(true);
      expect(await unsubscribe(trx, TENANT_A, token)).toBe(false);
    });
  });

  it('leaves nothing to send to a confirmed address, and answers the same', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const { token } = emailOf(await signUp(trx, 'test-a', INPUT, NO_PLATFORM));
      await confirmSignup(trx, TENANT_A, token);
      expect(await signUp(trx, 'test-a', INPUT, NO_PLATFORM)).toEqual({ outcome: 'accepted' });
    });
  });

  it("writes in the form's language, with its prefix, in the site's own words", async () => {
    await inRolledBackTransaction(async (trx) => {
      // As a platform admin, who alone changes a site's languages.
      await sql`SELECT set_config('app.user_id', ${USERS.platformAdmin}, true), set_config('app.aal', '2', true)`.execute(
        trx,
      );
      await sql`UPDATE app.tenants SET enabled_locales = '{es,en}' WHERE slug = 'test-a'`.execute(
        trx,
      );
      await asPublic(trx);
      const { message } = emailOf(
        await signUp(trx, 'test-a', { ...INPUT, locale: 'en' }, NO_PLATFORM),
      );
      expect(message.subject).toBe('Confirm you want to hear when Inquilino de prueba A is ready');
      tokenIn(message.text, 'https://test-a.example.test/en/avisos/confirmar');
    });
  });

  it("links to the platform's path for a site without its own hostname, and is unavailable without either", async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`UPDATE app.tenant_hostnames SET is_canonical = false WHERE hostname = 'test-b.example.test'`.execute(
        trx,
      );
      await asPublic(trx);
      expect(await signUp(trx, 'test-b', INPUT, NO_PLATFORM)).toEqual({ outcome: 'unavailable' });
      const { message } = emailOf(
        await signUp(trx, 'test-b', INPUT, { platformHost: 'plataforma.example.test' }),
      );
      tokenIn(message.text, 'https://plataforma.example.test/test-b/avisos/confirmar');
    });
  });

  it.each([
    ['an inactive site', 'test-inactive'],
    ['a site that does not exist', 'no-existe'],
  ])('finds no %s', async (_name, slug) => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(await signUp(trx, slug, INPUT, NO_PLATFORM)).toEqual({ outcome: 'not-found' });
    });
  });

  it.each([
    ['an address without a domain', { email: 'persona@ejemplo' }],
    ['two addresses', { email: 'a@example.org, b@example.org' }],
    ['a NUL character', { email: 'persona@example.org\u0000' }],
    ['a language the platform lacks', { locale: 'fr' }],
  ])('refuses %s before asking the database', async (_name, values) => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      expect(await signUp(trx, 'test-a', { ...INPUT, ...values }, NO_PLATFORM)).toEqual({
        outcome: 'invalid',
      });
    });
  });

  it("is refused by the database for a language the site doesn't offer", async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      await expect(
        signUp(trx, 'test-a', { ...INPUT, locale: 'en' }, NO_PLATFORM),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });
});

describe('sending the confirmation', () => {
  it('deletes the signup again when the email fails, so the person can try again at once', async () => {
    await inRolledBackTransaction(async (trx) => {
      await asPublic(trx);
      const pending = emailOf(await signUp(trx, 'test-a', INPUT, NO_PLATFORM));
      const failing: Mailer = {
        send: async () => {
          throw Object.assign(new Error('550 <persona@example.org> refused'), {
            responseCode: 550,
          });
        },
      };
      const errors: unknown[] = [];
      await sendOrUndo(trx, failing, pending, (error) => errors.push(error));
      expect(errors).toHaveLength(1);
      await asSuperuser(trx);
      const { rows } =
        await sql`SELECT 1 FROM app.signups WHERE email = 'persona@example.org'`.execute(trx);
      expect(rows).toEqual([]);
      await asPublic(trx);
      expect(emailOf(await signUp(trx, 'test-a', INPUT, NO_PLATFORM)).message.to).toBe(
        'persona@example.org',
      );
    });
  });
});

describe('confirming and unsubscribing', () => {
  it.each(['', 'corto', 'x'.repeat(43).replace('x', '!')])(
    'treat a malformed token %j as no one’s',
    async (token) => {
      await inRolledBackTransaction(async (trx) => {
        await asPublic(trx);
        expect(await confirmSignup(trx, TENANT_A, token)).toBe(false);
        expect(await unsubscribe(trx, TENANT_A, token)).toBe(false);
      });
    },
  );
});

describe('the signup service, with its own transactions', () => {
  /** The public role's own pool on the test database, as the API's is: what it commits stays, so tests clean up. */
  const publicPool = () => {
    const url = new URL(process.env.TEST_SUPERUSER_DATABASE_URL ?? '');
    url.searchParams.set('options', '-c role=aiontheballot_web');
    return createDatabase({ connectionString: url.toString(), maxConnections: 2 });
  };
  const owner = () =>
    createDatabase({
      connectionString: process.env.TEST_SUPERUSER_DATABASE_URL ?? '',
      maxConnections: 1,
    });

  it('answers before the email goes out, and undoes the signup when it fails', async () => {
    const db = publicPool();
    const cleanup = owner();
    const email = `servicio-${Date.now()}@example.org`;
    const rowCount = async () =>
      (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM app.signups WHERE email = ${email}`.execute(cleanup)
      ).rows[0]?.n;
    try {
      let release: (() => void) | undefined;
      const slow: Mailer = { send: () => new Promise<void>((resolve) => (release = resolve)) };
      const service = createSignups({ db, mailer: slow, platformHost: undefined });
      // The answer comes while the mail server hasn't answered at all.
      expect(await service.signUp('test-a', { ...INPUT, email })).toBe('accepted');
      expect(release).toBeDefined();
      expect(await rowCount()).toBe(1);
      release?.();
      await service.settle(1_000);
      expect(await rowCount()).toBe(1);

      await sql`DELETE FROM app.signups WHERE email = ${email}`.execute(cleanup);
      const steps: string[] = [];
      const failing = createSignups({
        db,
        mailer: { send: async () => Promise.reject(new Error('refused')) },
        platformHost: undefined,
        onMailError: (_error, step) => steps.push(step),
      });
      expect(await failing.signUp('test-a', { ...INPUT, email })).toBe('accepted');
      await failing.settle(1_000);
      expect(steps).toEqual(['send']);
      expect(await rowCount()).toBe(0);
    } finally {
      await sql`DELETE FROM app.signups WHERE email = ${email}`.execute(cleanup);
      await db.destroy();
      await cleanup.destroy();
    }
  });
});
