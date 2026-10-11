import type { BetterAuthOptions } from 'better-auth';

import { twoFactor } from 'better-auth/plugins/two-factor';

/**
 * Better Auth's tables as the migration `auth_schema` creates them, in the `auth` schema that only
 * `aiontheballot_auth` reaches (ADR-0002 §2): named the way the rest of the database is (plural, snake_case), with
 * uuid ids. Its runtime options take these, and a database test compiles Better Auth's own migration against the
 * tables and expects nothing left to create or add, so the two can't drift apart.
 */
export const AUTH_SCHEMA = 'auth';

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

export const AUTH_MODELS = {
  user: { modelName: 'users', fields: { emailVerified: 'email_verified', ...timestamps } },
  session: {
    modelName: 'sessions',
    fields: {
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      userId: 'user_id',
      ...timestamps,
    },
    additionalFields: {
      /**
       * 2 only for a session that a TOTP or backup code created (ADR-0002 §9): the API sets app.aal from it. Every
       * other session, such as the one a password alone opens for enrolment, stays 1 for life, so a session opened
       * before its user enrolled can't become aal2 when they enrol elsewhere. Set by the API (`input: false`).
       */
      aal: { type: 'number', required: true, defaultValue: 1, input: false },
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      ...timestamps,
    },
  },
  verification: {
    modelName: 'verifications',
    fields: { expiresAt: 'expires_at', ...timestamps },
  },
} satisfies Pick<BetterAuthOptions, 'user' | 'session' | 'account' | 'verification'>;

/** Failed attempts are counted in the database, so both API replicas share the count (editorial workflow A4.5). */
export const AUTH_RATE_LIMIT_STORAGE = {
  storage: 'database',
  modelName: 'rate_limits',
  fields: { lastRequest: 'last_request' },
} as const satisfies BetterAuthOptions['rateLimit'];

type TwoFactorPlugin = ReturnType<typeof twoFactor>;

/** The two-factor plugin (TOTP and backup codes), its table named like the others. */
export const twoFactorPlugin = (options: { issuer?: string } = {}): TwoFactorPlugin =>
  twoFactor({
    ...options,
    schema: {
      twoFactor: {
        modelName: 'two_factors',
        fields: {
          backupCodes: 'backup_codes',
          userId: 'user_id',
          failedVerificationCount: 'failed_verification_count',
          lockedUntil: 'locked_until',
        },
      },
      user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
    },
  });

/** Everything that decides the tables: what the migration was generated from. */
export interface AuthSchemaOptions extends Pick<
  BetterAuthOptions,
  'user' | 'session' | 'account' | 'verification' | 'emailAndPassword' | 'rateLimit' | 'advanced'
> {
  plugins: [TwoFactorPlugin];
}

export const authSchemaOptions = (issuer?: string): AuthSchemaOptions =>
  ({
    ...AUTH_MODELS,
    emailAndPassword: { enabled: true },
    plugins: [twoFactorPlugin(issuer === undefined ? {} : { issuer })],
    rateLimit: { enabled: true, ...AUTH_RATE_LIMIT_STORAGE },
    advanced: { database: { generateId: 'uuid' } },
  }) satisfies BetterAuthOptions;
