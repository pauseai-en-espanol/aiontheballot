import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { type SitePage, sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator, isLocale } from '@aiontheballot/i18n/messages';
import { type Kysely, sql, type Transaction } from 'kysely';
import { createHash, randomBytes } from 'node:crypto';

import type { Mailer, MailMessage } from './mail/mailer.js';

import { databaseRefusal } from './database-errors.js';

/**
 * The signup list's three public actions (PLAN R119, R122; public-site spec §6), through the database functions only
 * aiontheballot_web may call. Tokens are made here, sent by email, and only their SHA-256 reaches the database.
 */
export interface Signups {
  /**
   * Signs an address up to a site's list and emails it a confirmation, or does nothing it would tell a stranger about
   * (already confirmed, emailed too recently). The answer never says which, nor does how long it takes: the email
   * goes out after the answer.
   */
  signUp: (slug: string, input: SignupInput) => Promise<SignupOutcome>;
  /** Whether the token now belongs to a confirmed signup of the site. */
  confirm: (slug: string, token: string) => Promise<boolean>;
  /** Whether the token's signup was there to delete, on the site's list. */
  unsubscribe: (slug: string, token: string) => Promise<boolean>;
  /** Deletes the signups unconfirmed for 7 days (the database's rule), as every call above also does. */
  deleteExpired: () => Promise<void>;
}

export interface SignupInput {
  email: string;
  /** The form's language: the email is written in it, and its links lead to the pages in it. */
  locale: string;
  futureElections: boolean;
}

export type SignupOutcome =
  /** Done, whatever was done: the public hears the same in every case. */
  | 'accepted'
  /** No active site has the slug. */
  | 'not-found'
  /** The site takes no signups (no published privacy policy, a language it lacks), or has no address to link to. */
  | 'unavailable'
  | 'invalid'
  /** The site's daily cap. */
  | 'limit';

/**
 * An address as the form takes it: one `@`, a dot in the domain, nothing a header could misread, no control
 * character. Checked after normalising (`normaliseAddress`).
 */
const ADDRESS =
  /^[^\s\p{Cc}@<>()",;:\\[\]]+@[^\s\p{Cc}@<>()",;:\\[\].]+(?:\.[^\s\p{Cc}@<>()",;:\\[\].]+)+$/u;

/** 256 random bits, base64url: what a link carries. */
const TOKEN = /^[\w-]{43}$/u;

const sha256 = (token: string): string => createHash('sha256').update(token).digest('hex');

export const makeToken = (): string => randomBytes(32).toString('base64url');

/**
 * One spelling per address, so variants of one mailbox are one row and one throttle: trimmed, Unicode NFC,
 * lowercased, and an internationalised domain in its ASCII (punycode) form. Undefined for anything that isn't one.
 */
export const normaliseAddress = (email: string): string | undefined => {
  const trimmed = email.trim().normalize('NFC').toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || /[\s\p{Cc}/?#\\]/u.test(trimmed)) {
    return undefined;
  }
  let domain: string;
  try {
    ({ hostname: domain } = new URL(`http://${trimmed.slice(at + 1)}`));
  } catch {
    return undefined;
  }
  const address = `${trimmed.slice(0, at)}@${domain}`;
  return address.length <= 254 && ADDRESS.test(address) ? address : undefined;
};

/** What `signUp` leaves to do once its transaction has committed: the email to send, and how to undo it. */
export interface PendingEmail {
  tenantId: string;
  token: string;
  message: MailMessage;
}

export type SignUpResult =
  | { outcome: 'accepted'; email?: PendingEmail }
  | { outcome: 'not-found' | 'unavailable' | 'invalid' };

/** The tenant's id by slug, as the public role sees it: only an active tenant's. */
const tenantIdOf = async (db: Kysely<DB>, slug: string): Promise<string | undefined> =>
  (await db.selectFrom('app.tenants').select('id').where('slug', '=', slug).executeTakeFirst())?.id;

/**
 * Signs an address up in `trx` (as aiontheballot_web) and returns its confirmation email to send once `trx` has
 * committed, when the database says to send one. A database refusal throws.
 */
export const signUp = async (
  trx: Transaction<DB>,
  slug: string,
  { email, locale, futureElections }: SignupInput,
  { platformHost }: { platformHost: string | undefined },
): Promise<SignUpResult> => {
  const address = normaliseAddress(email);
  if (!address || !isLocale(locale)) {
    return { outcome: 'invalid' };
  }
  const site = await trx
    .selectFrom('app.tenants as t')
    .innerJoin('app.tenant_organizations as link', (join) =>
      join.onRef('link.tenant_id', '=', 't.id').on('link.role', '=', 'operator'),
    )
    .innerJoin('app.organizations as o', 'o.id', 'link.organization_id')
    .select([
      't.id',
      't.default_locale',
      't.display_name',
      'o.display_name as operator_name',
      'o.contact_email',
      (eb) =>
        eb
          .selectFrom('app.tenant_hostnames as h')
          .select('h.hostname')
          .whereRef('h.tenant_id', '=', 't.id')
          .where('h.is_canonical', '=', true)
          .as('canonical_host'),
    ])
    .where('t.slug', '=', slug)
    .executeTakeFirst();
  if (!site) {
    return { outcome: 'not-found' };
  }
  // The tenant's canonical base (ADR-0002): its own hostname, else the platform's path; never the Host header.
  const base = site.canonical_host
    ? `https://${site.canonical_host}`
    : platformHost
      ? `https://${platformHost}/${slug}`
      : undefined;
  if (!base) {
    return { outcome: 'unavailable' };
  }
  const link = (page: SitePage, token?: string) =>
    `${base}${locale === site.default_locale ? '' : `/${locale}`}${sitePath(site.default_locale, page)}${
      token ? `?t=${token}` : ''
    }`;
  const name = (value: unknown) =>
    pickLocalized(value as Record<string, string>, locale, site.default_locale) ?? '';

  const token = makeToken();
  const { rows } = await sql<{ send: boolean }>`
    SELECT app.sign_up(${site.id}::uuid, ${address}, ${locale}, ${futureElections}, ${sha256(token)}) AS send
  `.execute(trx);
  if (!rows[0]?.send) {
    return { outcome: 'accepted' };
  }
  const t = getTranslator(locale);
  const operator = name(site.operator_name);
  const siteName = name(site.display_name);
  return {
    outcome: 'accepted',
    email: {
      tenantId: site.id,
      token,
      message: {
        to: address,
        fromName: operator,
        replyTo: site.contact_email ?? undefined,
        subject: t('email.signupConfirm.subject', { site: siteName }),
        text: t('email.signupConfirm.body', {
          site: siteName,
          operator,
          future: String(futureElections),
          confirmUrl: link({ page: 'confirm' }, token),
          unsubscribeUrl: link({ page: 'unsubscribe' }, token),
          privacyUrl: link({ page: 'privacy' }),
        }),
        // RFC 8058's one-click address: the form's own target, which a mail client posts to.
        unsubscribeUrl: `${link({ page: 'updates' })}?action=unsubscribe&t=${token}`,
      },
    },
  };
};

/** Whether the token now belongs to a confirmed signup of the tenant. A malformed token is no one's. */
export const confirmSignup = async (
  db: Kysely<DB>,
  tenantId: string,
  token: string,
): Promise<boolean> => {
  if (!TOKEN.test(token)) {
    return false;
  }
  const { rows } = await sql<{ done: boolean }>`
    SELECT app.confirm_signup(${tenantId}::uuid, ${sha256(token)}) AS done
  `.execute(db);
  return rows[0]?.done === true;
};

/** Whether the token's signup was there to delete, on the tenant's list. */
export const unsubscribe = async (
  db: Kysely<DB>,
  tenantId: string,
  token: string,
): Promise<boolean> => {
  if (!TOKEN.test(token)) {
    return false;
  }
  const { rows } = await sql<{ done: boolean }>`
    SELECT app.unsubscribe(${tenantId}::uuid, ${sha256(token)}) AS done
  `.execute(db);
  return rows[0]?.done === true;
};

/** What a refused signup tells the public, or undefined for a fault to throw. */
export const failedSignup = (error: unknown): SignupOutcome | undefined => {
  switch (databaseRefusal(error).status) {
    // The site takes no signups: no published privacy policy, or a language it doesn't offer.
    case 400:
      return 'unavailable';
    // An address the database's check refuses.
    case 422:
      return 'invalid';
    case 429:
      return 'limit';
    default:
      return undefined;
  }
};

/**
 * Sends a committed signup's email; if that fails, deletes the signup again (its token unsubscribes it), so the person
 * can try again at once, and reports the failure.
 */
export const sendOrUndo = async (
  db: Kysely<DB>,
  mailer: Mailer,
  { tenantId, token, message }: PendingEmail,
  onMailError: (error: unknown) => void,
): Promise<void> => {
  try {
    await mailer.send(message);
  } catch (error) {
    onMailError(error);
    await unsubscribe(db, tenantId, token).catch(onMailError);
  }
};

/**
 * The public's three actions on `db`, the aiontheballot_web role's pool. A signup runs in a transaction of its own;
 * its email goes out after the transaction commits and after the answer, so neither the answer nor its timing depends
 * on whether an email was sent, and no transaction waits on the mail server.
 */
export const createSignups = ({
  db,
  mailer,
  platformHost,
  onMailError = () => undefined,
}: {
  db: Database;
  mailer: Mailer;
  platformHost: string | undefined;
  /** Told when an email couldn't be sent (reported by the server without the address). */
  onMailError?: (error: unknown) => void;
}): Signups => ({
  signUp: async (slug, input) => {
    let result: SignUpResult;
    try {
      result = await db.transaction().execute((trx) => signUp(trx, slug, input, { platformHost }));
    } catch (error) {
      const outcome = failedSignup(error);
      if (!outcome) {
        throw error;
      }
      return outcome;
    }
    if (result.outcome === 'accepted' && result.email) {
      void sendOrUndo(db, mailer, result.email, onMailError);
    }
    return result.outcome;
  },
  confirm: async (slug, token) => {
    const tenantId = await tenantIdOf(db, slug);
    return tenantId ? confirmSignup(db, tenantId, token) : false;
  },
  unsubscribe: async (slug, token) => {
    const tenantId = await tenantIdOf(db, slug);
    return tenantId ? unsubscribe(db, tenantId, token) : false;
  },
  deleteExpired: async () => {
    await sql`SELECT app.confirm_signup(NULL, NULL)`.execute(db);
  },
});
