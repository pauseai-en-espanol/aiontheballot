import { type Dsn, readDsn } from '@aiontheballot/observability/dsn';

import { readArchiveUrl } from './fetcher/archive.js';
import { readSharedToken, readWorkerToken } from './worker/token.js';

export interface ApiConfig {
  host: string;
  port: number;
  logLevel: string;
  /** GlitchTip project for the API; undefined turns error tracking off. */
  sentryDsn: Dsn | undefined;
  /**
   * The read-only aiontheballot_web role's connection, for public routes (ADR-0003 §1). Undefined leaves them
   * unavailable (503) rather than failing the whole API.
   */
  webDatabaseUrl: string | undefined;
  /**
   * The admin's preview of a site (PLAN R181; ADR-0005): the read-only aiontheballot_preview role's connection, which
   * also sees elections in preview, and the secret the web app sends for it, the one it shares with the admin
   * (PREVIEW_TOKEN). Undefined: the preview's routes answer 503.
   */
  preview: { databaseUrl: string; token: string } | undefined;
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
  /** The platform's mail sender (PLAN R115). Undefined: nothing sends mail, and no site offers its signup form. */
  mail: MailConfig | undefined;
  /**
   * The platform domain, as the web app's PLATFORM_HOST: links in emails of tenants without a hostname of their own
   * point there (ADR-0002, canonical addresses).
   */
  platformHost: string | undefined;
  /**
   * The worker (PLAN R116; ADR-0006): its address inside the cluster, where extraction jobs are handed over with their
   * copy, and the secret it checks on each. Undefined: copies are stored and their extraction waits.
   */
  worker: { url: string; token: string } | undefined;
  /**
   * The fetcher (ADR-0007): its address inside the cluster, where copies by URL and snapshots are asked for, and the
   * secret it checks on each. Undefined: copies are uploaded only, and no snapshot is taken.
   */
  fetcher: { url: string; token: string } | undefined;
  /** The archive's address (ARCHIVE_URL, the Internet Archive's by default): every snapshot's starts with it. */
  archiveUrl: string;
  /**
   * Whether the API takes right-of-reply reports (PLAN R149): only while their retention is enforced, which the chart
   * says (REPORTS_ENABLED=true) when it renders the daily anonymization. Off, the form isn't offered.
   */
  reportsEnabled: boolean;
  /**
   * The public site's pods, through a headless Service whose name resolves to each (R151), told when a site's public
   * data changes. Undefined: they catch up within their minute.
   */
  webRevalidateUrl: string | undefined;
}

export interface MailConfig {
  /**
   * The platform's SMTP submission with the platform account's credentials: `smtps://user:password@host:465`, or
   * `smtp://…` with STARTTLS. Never logged.
   */
  smtpUrl: string;
  /** The sending address, for the envelope and the From header; the From name is the operator's for a site's mail. */
  from: string;
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

/** A plain address, as the sender: no display name, no spaces, one `@`. */
const ADDRESS = /^[^\s@<>"]+@[^\s@<>".]+(?:\.[^\s@<>".]+)+$/u;

/** Mail needs both settings or neither. Errors never echo the URL, which holds a password. */
const readMail = (env: NodeJS.ProcessEnv): MailConfig | undefined => {
  const smtpUrl = env.SMTP_URL || undefined;
  const from = env.MAIL_FROM || undefined;
  if (!smtpUrl && !from) {
    return undefined;
  }
  if (!smtpUrl || !from) {
    throw new Error(`Mail is half configured: ${smtpUrl ? 'MAIL_FROM' : 'SMTP_URL'} not set`);
  }
  let protocol: string;
  try {
    ({ protocol } = new URL(smtpUrl));
  } catch {
    throw new Error('SMTP_URL must be a URL such as smtps://user:password@mail.example.org:465');
  }
  if (protocol !== 'smtp:' && protocol !== 'smtps:') {
    throw new Error('SMTP_URL must start with smtp:// or smtps://');
  }
  if (!ADDRESS.test(from)) {
    throw new Error('MAIL_FROM must be a plain address, such as avisos@example.org');
  }
  return { smtpUrl, from };
};

/** The worker needs its address and the shared secret, or neither. Errors never echo the secret. */
const readWorker = (env: NodeJS.ProcessEnv): ApiConfig['worker'] => {
  const url = env.WORKER_URL || undefined;
  const token = env.WORKER_TOKEN || undefined;
  if (!url && !token) {
    return undefined;
  }
  if (!url) {
    throw new Error('The worker is half configured: WORKER_URL not set');
  }
  return { url, token: readWorkerToken(token) };
};

/** The fetcher needs its address and the shared secret, or neither (ADR-0007). Errors never echo the secret. */
const readFetcher = (env: NodeJS.ProcessEnv): ApiConfig['fetcher'] => {
  const url = env.FETCHER_URL || undefined;
  const token = env.FETCHER_TOKEN || undefined;
  if (!url && !token) {
    return undefined;
  }
  if (!url) {
    throw new Error('The fetcher is half configured: FETCHER_URL not set');
  }
  return { url, token: readSharedToken('FETCHER_TOKEN', token) };
};

/** The preview needs its role's connection and the shared secret, or neither. Errors never echo either. */
const readPreview = (env: NodeJS.ProcessEnv): ApiConfig['preview'] => {
  const databaseUrl = env.PREVIEW_DATABASE_URL || undefined;
  const token = env.PREVIEW_TOKEN || undefined;
  if (!databaseUrl && !token) {
    return undefined;
  }
  if (!databaseUrl) {
    throw new Error('The preview is half configured: PREVIEW_DATABASE_URL not set');
  }
  return { databaseUrl, token: readSharedToken('PREVIEW_TOKEN', token) };
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
    preview: readPreview(env),
    filesRoot: env.FILES_ROOT || undefined,
    auth: readAuth(env),
    adminDatabaseUrl: env.ADMIN_DATABASE_URL || undefined,
    mail: readMail(env),
    platformHost: env.PLATFORM_HOST || undefined,
    worker: readWorker(env),
    fetcher: readFetcher(env),
    archiveUrl: readArchiveUrl(env.ARCHIVE_URL),
    reportsEnabled: env.REPORTS_ENABLED === 'true',
    webRevalidateUrl: env.WEB_REVALIDATE_URL || undefined,
  };
};
