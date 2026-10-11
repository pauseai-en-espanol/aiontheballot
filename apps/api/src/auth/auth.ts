import type { createAuthPool } from '@aiontheballot/db/auth-pool';

import { betterAuth, type BetterAuthOptions } from 'better-auth';

import type { FoundSession } from './session.js';

import { AUTH_MODELS, authSchemaOptions } from './schema.js';

/** A session ends this long after sign-in, and is never extended (editorial workflow A4.4). */
export const SESSION_SECONDS = 12 * 60 * 60;

/** Shorter passwords are refused (editorial workflow A5.1). */
export const MIN_PASSWORD_LENGTH = 12;

/** Longer ones too: Better Auth's own maximum, which sign-in and resets apply, set here so every path agrees. */
export const MAX_PASSWORD_LENGTH = 128;

/** Where Better Auth's endpoints live on the admin host (ADR-0003 §2). */
export const AUTH_BASE_PATH = '/api/auth';

/** How long a link to set a password works, once (editorial workflow A1.1, A5.2). */
export const SET_PASSWORD_LINK_SECONDS = 60 * 60;

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

/** The endpoints whose sessions passed a second factor: only their sessions are aal2 (ADR-0002 §9). */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);

export interface AuthOptions {
  /** createAuthPool's connections, as aiontheballot_auth. */
  pool: ReturnType<typeof createAuthPool>;
  secret: string;
  adminOrigin: string;
  totpIssuer: string;
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
    Pick<NonNullable<BetterAuthOptions['session']>, 'expiresIn' | 'disableSessionRefresh'>;
};

/**
 * Better Auth as the admin uses it (ADR-0003 §2; editorial workflow A4): email and password with no sign-up, then a
 * TOTP or backup code; sessions of 12 hours, never refreshed, with no "remember me"; attempts limited per address in
 * the database, so both API replicas share the counts. Only the endpoints routes.ts lets through are reachable.
 */
export const authOptions = ({
  pool,
  secret,
  adminOrigin,
  totpIssuer,
}: AuthOptions): AdminAuthOptions => {
  const schema = authSchemaOptions(totpIssuer);
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
      onPasswordReset: async ({ user }) => {
        await pool.query('DELETE FROM verifications WHERE value = $1', [user.id]);
      },
    },
    // A link's token is kept only as its SHA-256, so whoever reads the table (or a backup) can't use one.
    verification: {
      ...AUTH_MODELS.verification,
      storeIdentifier: { default: 'plain', overrides: { 'reset-password:': 'hashed' } },
    },
    session: {
      // The models themselves rather than the schema options' copy, whose wider type loses the `aal` field's.
      ...AUTH_MODELS.session,
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
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
          // creates it: aal2 only behind a second factor.
          before: async (session, context) => ({
            data: { ...session, aal: context && SECOND_FACTOR_PATHS.has(context.path) ? 2 : 1 },
          }),
        },
      },
    },
    telemetry: { enabled: false },
  };
};

export const createAuth = (options: AuthOptions): Auth => betterAuth(authOptions(options));
