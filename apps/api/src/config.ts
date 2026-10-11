import { type Dsn, readDsn } from '@aiontheballot/observability/dsn';

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  /** GlitchTip project for the API (in-cluster Service); undefined turns error tracking off. */
  sentryDsn: Dsn | undefined;
  /**
   * The read-only aiontheballot_web role's connection, for public routes (ADR-0003 §1). Undefined leaves them
   * unavailable (503) rather than failing the whole API.
   */
  webDatabaseUrl: string | undefined;
  /**
   * Where stored files' bytes live (ADR-0001: a persistent volume, under their SHA-256). Undefined leaves the routes
   * that serve them unavailable (503).
   */
  filesRoot: string | undefined;
  /** Sign-in (Better Auth, ADR-0003 §2); undefined leaves /api/auth and the signed-in routes unavailable (503). */
  auth: AuthConfig | undefined;
  /**
   * The aiontheballot_admin role's connection, for everything a signed-in user does (withActor, ADR-0002 §3).
   * Undefined leaves the signed-in data routes unavailable (503).
   */
  adminDatabaseUrl: string | undefined;
}

export interface AuthConfig {
  /**
   * The central admin host's origin (ADR-0003 §4), such as `https://admin.example.org`: Better Auth's base URL, the
   * only origin it trusts, and the only host `/api/*` answers on.
   */
  adminOrigin: string;
  /** Better Auth's own role, aiontheballot_auth (ADR-0002 §2). */
  databaseUrl: string;
  /** Signs cookies and encrypts TOTP secrets and backup codes. */
  secret: string;
  /** What authenticator apps file the account under: the platform's name, from PLATFORM_NAME. */
  totpIssuer: string;
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** Shorter than this, a secret is guessable; Better Auth itself asks for 32 characters. */
const MIN_SECRET_LENGTH = 32;

/**
 * Hosts a browser treats as secure over plain http, so `Secure` and `__Host-` cookies work there: local development
 * and the end-to-end tests only.
 */
const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]';

/**
 * An origin and nothing else: https (or http on a loopback host), with no path, query, fragment or credentials. Errors
 * don't echo the value, which could hold credentials.
 */
const readOrigin = (value: string, name: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an origin such as https://admin.example.org`);
  }
  const secure =
    url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
  if (!secure || url.origin !== value.replace(/\/$/, '')) {
    throw new Error(
      `${name} must be an https origin (http only on a loopback host) with no path or credentials`,
    );
  }
  return url.origin;
};

/**
 * Sign-in needs all of its settings or none: some without the others is a deployment mistake, which fails here rather
 * than at the first sign-in. Errors never echo a secret or a connection string.
 */
const readAuth = (env: NodeJS.ProcessEnv): AuthConfig | undefined => {
  const settings = {
    ADMIN_ORIGIN: env.ADMIN_ORIGIN || undefined,
    AUTH_DATABASE_URL: env.AUTH_DATABASE_URL || undefined,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || undefined,
    PLATFORM_NAME: env.PLATFORM_NAME || undefined,
  };
  const {
    ADMIN_ORIGIN: adminOrigin,
    AUTH_DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: secret,
    PLATFORM_NAME: totpIssuer,
  } = settings;
  if (!adminOrigin && !databaseUrl && !secret) {
    return undefined;
  }
  if (!adminOrigin || !databaseUrl || !secret || !totpIssuer) {
    const missing = Object.entries(settings)
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(`Sign-in is half configured: ${missing.join(', ')} not set`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`BETTER_AUTH_SECRET must have at least ${MIN_SECRET_LENGTH} characters`);
  }
  return { adminOrigin: readOrigin(adminOrigin, 'ADMIN_ORIGIN'), databaseUrl, secret, totpIssuer };
};

/** Reads the API configuration from the environment, failing fast on invalid values. */
export const loadConfig = (env: NodeJS.ProcessEnv): ApiConfig => {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}"`);
  }
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${logLevel}"`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    logLevel,
    sentryDsn: readDsn(env),
    webDatabaseUrl: env.WEB_DATABASE_URL || undefined,
    filesRoot: env.FILES_ROOT || undefined,
    auth: readAuth(env),
    adminDatabaseUrl: env.ADMIN_DATABASE_URL || undefined,
  };
};
