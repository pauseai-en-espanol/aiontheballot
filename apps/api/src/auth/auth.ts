import type { createAuthPool } from '@aiontheballot/db/auth-pool';

import { requestLocale } from '@aiontheballot/i18n/negotiate';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { createHash } from 'node:crypto';

import type { PasswordMail } from './password-mail.js';
import type { FoundSession } from './session.js';

import { passwordLinkRow } from './password-link-rows.js';
import { AUTH_MODELS, authSchemaOptions } from './schema.js';

/** A session ends this long after sign-in at the latest, however much it is used (editorial workflow A4.4, D22). */
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

/** And this long after it was last used: each use moves its end on, up to SESSION_SECONDS (PLAN D22). */
export const SESSION_IDLE_SECONDS = 48 * 60 * 60;

/** A passkey is added only from a session at most this old: a sign-in of the last 12 hours (PLAN D22). */
export const FRESH_SESSION_SECONDS = 12 * 60 * 60;

/**
 * What a passkey's answer must say for it to count as the second factor: that the device checked who holds it
 * (fingerprint, face or PIN), not only that someone touched it. Better Auth's plugin asks for that and then accepts
 * either, so both ceremonies check it here.
 */
export const USER_NOT_VERIFIED = 'PASSKEY_USER_NOT_VERIFIED';
const unverified = () =>
  new APIError('UNAUTHORIZED', {
    code: USER_NOT_VERIFIED,
    message: 'The passkey did not check who holds the device',
  });

/** Shorter passwords are refused (editorial workflow A5.1). */
export const MIN_PASSWORD_LENGTH = 12;

/** Longer ones too: Better Auth's own maximum, which sign-in and resets apply, set here so every path agrees. */
export const MAX_PASSWORD_LENGTH = 128;

/** Where Better Auth's endpoints live on the admin host (ADR-0003 §2). */
export const AUTH_BASE_PATH = '/api/auth';

/** How long a link to set a password works, once (editorial workflow A1.1, A5.2). */
export const SET_PASSWORD_LINK_SECONDS = 60 * 60;

/** An account is sent at most one link to choose a password this often, however often one is asked for (PLAN R170). */
export const PASSWORD_LINK_COOLDOWN_SECONDS = 15 * 60;

/** Links made within the cooldown: those expiring later than a link made that long ago would. */
const RECENT_LINK_SECONDS = SET_PASSWORD_LINK_SECONDS - PASSWORD_LINK_COOLDOWN_SECONDS;

/** How many unused links to set a password the account was given in the last PASSWORD_LINK_COOLDOWN_SECONDS. */
export const recentPasswordLinks = async (
  pool: ReturnType<typeof createAuthPool>,
  userId: string,
): Promise<number> => {
  const { rows } = await pool.query<{ links: number }>(
    `SELECT count(*)::int AS links FROM verifications v
      WHERE v.value = $1 AND ${passwordLinkRow('v')} AND v.expires_at > now() + make_interval(secs => $2)`,
    [userId, RECENT_LINK_SECONDS],
  );
  return rows[0]?.links ?? 0;
};

/**
 * How a link's verification is stored: the SHA-256 of `reset-password:<token>`, base64url without padding, which is
 * Better Auth's own `hashed` storage, spelled out so the API can find one link by its token.
 */
const storedLinkIdentifier = async (identifier: string): Promise<string> =>
  createHash('sha256').update(identifier).digest('base64url');

/** Forgets one link by its token: one never mailed, which nobody holds and would only delay the next. */
export const forgetPasswordLink = async (
  pool: ReturnType<typeof createAuthPool>,
  token: string,
): Promise<void> => {
  await pool.query('DELETE FROM verifications WHERE identifier = $1', [
    await storedLinkIdentifier(`reset-password:${token}`),
  ]);
};

/**
 * Whether the link with `token` is held back: the account has another unused one made in the last 15 minutes, or no
 * longer has its second factor (or is gone). If so, this one is forgotten. Checks of one account's links take turns,
 * on its row (`FOR NO KEY UPDATE`, which a session being inserted for it doesn't wait for), and each sees what the one
 * before it kept or forgot: of two links made at once, exactly one goes out, whichever order they were written in and
 * whatever their creation times say (written by different replicas, those needn't follow the order the rows were
 * written in). The owner's reset of a lost authenticator locks the same row and forgets the links it finds, so a
 * link written after it is caught here: its sender saw the factor, but it is gone (ADR-0002 §10).
 */
export const heldBackPasswordLink = async (
  pool: ReturnType<typeof createAuthPool>,
  userId: string,
  token: string,
): Promise<boolean> => {
  const identifier = await storedLinkIdentifier(`reset-password:${token}`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await client.query<{ enrolled: boolean }>(
      'SELECT coalesce(two_factor_enabled, false) AS enrolled FROM users WHERE id = $1 FOR NO KEY UPDATE',
      [userId],
    );
    const { rows } = await client.query<{ held: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM verifications o
          WHERE o.value = $1 AND o.identifier <> $2 AND ${passwordLinkRow('o')}
            AND o.expires_at > now() + make_interval(secs => $3)) AS held`,
      [userId, identifier, RECENT_LINK_SECONDS],
    );
    const held = account.rows[0]?.enrolled !== true || rows[0]?.held === true;
    if (held) {
      await client.query('DELETE FROM verifications WHERE identifier = $1', [identifier]);
    }
    await client.query('COMMIT');
    return held;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Whether the account has its second factor. Only such an account is sent a link: a new password then still needs a
 * code, so whoever reads the mailbox gets nothing from one (ADR-0002 §9). An account still to enrol (a member who
 * accepted an invitation but never finished, or one whose authenticator the owner just reset) would be theirs.
 */
export const hasSecondFactor = (user: object): boolean =>
  (user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true;

/**
 * Every cookie Better Auth sets is host-only and sent only over https (`__Host-`: `Secure`, `Path=/`, no `Domain`),
 * `HttpOnly` and `SameSite=Lax` (ADR-0002 §15): the session, and the short-lived one that holds a sign-in between the
 * password and the code.
 */
const COOKIE_PREFIX = '__Host-admin';
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;

/**
 * The header Better Auth reads the visitor's address from, for its rate limiter and the session's record. Only the API
 * writes it, from the gateway's `X-Forwarded-For` entry (visitor.ts), replacing whatever a client sent.
 */
export const VISITOR_ADDRESS_HEADER = 'x-aiontheballot-visitor';

/**
 * The endpoints whose sessions passed a second factor: only their sessions are aal2 (ADR-0002 §9). A passkey's sign-in
 * is one (PLAN D22): the device holds the key and checked who holds the device (USER_NOT_VERIFIED), and only an
 * account with TOTP has one (migration passkeys).
 */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/passkey/verify-authentication',
]);

export interface AuthOptions {
  /** createAuthPool's connections, as aiontheballot_auth. */
  pool: ReturnType<typeof createAuthPool>;
  secret: string;
  adminOrigin: string;
  totpIssuer: string;
  /**
   * Password recovery's mail (editorial workflow A5; PLAN R170). Without it, asking for a link is refused as Better
   * Auth refuses it, and a changed password sends no notice.
   */
  passwordMail?: PasswordMail | undefined;
  /** A recovery email that could not be sent, which nobody waits for: to report, never with the address. */
  onMailError?: ((error: unknown) => void) | undefined;
}

/** What the API uses of Better Auth: its endpoints, and reading a request's session. */
export interface Auth {
  handler: (request: Request) => Promise<Response>;
  api: { getSession: (context: { headers: Headers }) => Promise<FoundSession | null> };
}

/**
 * Better Auth's options, typed so that its sessions carry `aal` (the session model's own type, which the generic
 * options would widen away).
 */
export type AdminAuthOptions = Omit<BetterAuthOptions, 'session'> & {
  session: typeof AUTH_MODELS.session &
    Pick<
      NonNullable<BetterAuthOptions['session']>,
      'expiresIn' | 'disableSessionRefresh' | 'freshAge'
    >;
};

/**
 * Better Auth as the admin uses it (ADR-0003 §2; editorial workflow A4): email and password with no sign-up, then a
 * TOTP or backup code, or a passkey alone; sessions that end after 48 hours unused or a week after sign-in, with no
 * "remember me"; attempts limited per address in the database, so both API replicas share the counts. Only the
 * endpoints routes.ts lets through are reachable.
 */
export const authOptions = ({
  pool,
  secret,
  adminOrigin,
  totpIssuer,
  passwordMail,
  onMailError = () => undefined,
}: AuthOptions): AdminAuthOptions => {
  // Passkeys belong to the admin host and nowhere else: its name, and its origin rather than whatever a request says.
  // Moving the admin to another host means adding them again (ADR-0003 §4).
  const schema = authSchemaOptions(totpIssuer, {
    rpID: new URL(adminOrigin).hostname,
    rpName: totpIssuer,
    origin: adminOrigin,
    // Discoverable, so the sign-in page needs no email first; and the device checks who holds it.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    registration: {
      afterVerification: async ({ verification }) => {
        if (verification.registrationInfo?.userVerified !== true) {
          throw unverified();
        }
      },
    },
    authentication: {
      afterVerification: async ({ verification }) => {
        if (!verification.authenticationInfo.userVerified) {
          throw unverified();
        }
      },
    },
  });
  // Mail nobody waits for: an answer never says whether an address has an account by how long it took.
  const inBackground = (send: () => Promise<void>): void => {
    send().catch(onMailError);
  };
  return {
    ...schema,
    appName: totpIssuer,
    database: pool,
    secret,
    baseURL: adminOrigin,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [adminOrigin],
    emailAndPassword: {
      enabled: true,
      // Accounts come only from invitations and the owner's command (editorial workflow A1, A3).
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      // A link to set a password: single use, an hour. Setting one ends all the account's sessions (A5.3), and every
      // other link or pending sign-in the account still has (verification values name their user), so an older link
      // can't set a password over the new one.
      resetPasswordTokenExpiresIn: SET_PASSWORD_LINK_SECONDS,
      revokeSessionsOnPasswordReset: true,
      // The second factor stays as it is, so the next sign-in still asks for it (A5.3). The account is told, in the
      // language of the page that set it.
      onPasswordReset: async ({ user }, request) => {
        await pool.query('DELETE FROM verifications WHERE value = $1', [user.id]);
        // Better Auth ends them next, outside any transaction: ended here first, so a failure there leaves none.
        await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        if (passwordMail) {
          const locale = requestLocale(request?.headers ?? new Headers());
          inBackground(() =>
            passwordMail.changed({ email: user.email, locale, enrolled: hasSecondFactor(user) }),
          );
        }
      },
      // "I forgot my password" (A5.2): Better Auth answers the same whether or not the address has an account, and
      // makes the link only for one that has; it goes out in the background, in the sign-in page's language, unless
      // the account has no second factor yet, or was sent another in the last 15 minutes (so nobody can flood a
      // member's inbox). A link that isn't sent is forgotten.
      ...(passwordMail
        ? {
            sendResetPassword: async ({ user, token }, request) => {
              const locale = requestLocale(request?.headers ?? new Headers());
              inBackground(async () => {
                if (!hasSecondFactor(user)) {
                  await forgetPasswordLink(pool, token);
                  return;
                }
                if (await heldBackPasswordLink(pool, user.id, token)) {
                  return;
                }
                try {
                  await passwordMail.link({ email: user.email, token, locale });
                } catch (error) {
                  await forgetPasswordLink(pool, token);
                  throw error;
                }
              });
            },
          }
        : {}),
    },
    // A link's token is kept only as its SHA-256, so whoever reads the table (or a backup) can't use one.
    verification: {
      ...AUTH_MODELS.verification,
      storeIdentifier: {
        default: 'plain',
        overrides: { 'reset-password:': { hash: storedLinkIdentifier } },
      },
    },
    session: {
      // The models themselves rather than the schema options' copy, whose wider type loses the `aal` field's.
      ...AUTH_MODELS.session,
      // The cookie lasts the week; the row's end, which createAuth moves on as the session is used, decides.
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
      freshAge: FRESH_SESSION_SECONDS,
    },
    advanced: {
      ...schema.advanced,
      cookiePrefix: COOKIE_PREFIX,
      // `__Secure-` would be prepended to `__Host-`; the attributes below make the cookies secure instead.
      useSecureCookies: false,
      defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: [VISITOR_ADDRESS_HEADER] },
    },
    databaseHooks: {
      session: {
        create: {
          // Whatever a session copies from the one it replaces, its level is decided here, from the endpoint that
          // creates it: aal2 only behind a second factor. It starts with SESSION_IDLE_SECONDS to live.
          before: async (session, context) => ({
            data: {
              ...session,
              aal: context && SECOND_FACTOR_PATHS.has(context.path) ? 2 : 1,
              expiresAt: new Date(
                Math.min(session.expiresAt.getTime(), Date.now() + SESSION_IDLE_SECONDS * 1000),
              ),
            },
          }),
        },
      },
    },
    telemetry: { enabled: false },
  };
};

/**
 * A session in use lives on: its end moves to SESSION_IDLE_SECONDS from now, never past SESSION_SECONDS from sign-in
 * (which migration sessions_within_a_week holds too). Written at most once a minute per session; one already ended
 * stays ended.
 */
export const keepSessionAlive = async (
  pool: ReturnType<typeof createAuthPool>,
  sessionId: string,
): Promise<void> => {
  const until = 'least(created_at + make_interval(secs => $2), now() + make_interval(secs => $3))';
  await pool.query(
    `UPDATE sessions SET expires_at = ${until}
      WHERE id = $1 AND expires_at > now() AND expires_at < ${until} - interval '1 minute'`,
    [sessionId, SESSION_SECONDS, SESSION_IDLE_SECONDS],
  );
};

export const createAuth = (options: AuthOptions): Auth => {
  const auth: Auth = betterAuth(authOptions(options));
  return {
    handler: auth.handler,
    api: {
      // Every request that finds its session (routes.ts) uses it. Better Auth's own refresh is off: it would move the
      // row's end but not the cookie's, which the API reads on the server, and never stop at a week.
      getSession: async (context) => {
        const found = await auth.api.getSession(context);
        if (found) {
          await keepSessionAlive(options.pool, found.session.id);
        }
        return found;
      },
    },
  };
};
