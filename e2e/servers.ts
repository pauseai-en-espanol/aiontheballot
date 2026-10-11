/**
 * Where the e2e run serves each app's production build. The ports stay clear of `pnpm dev` (3000-3002).
 */
export const PORTS = {
  web: 4100,
  api: 4101,
  admin: 4102,
  glitchtip: 4103,
  plausible: 4104,
  gateway: 4105,
  smtp: 4106,
  mailbox: 4107,
} as const;

export const WEB_URL = `http://127.0.0.1:${PORTS.web}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
/** The admin's own server, which only the gateway calls. */
export const ADMIN_SERVER_URL = `http://127.0.0.1:${PORTS.admin}`;
/**
 * The admin host, through the stand-in gateway (fake-gateway.ts), as browsers reach it in production. `localhost`, so
 * the browser treats it as secure and keeps the sign-in's `__Host-` cookies over plain http.
 */
export const ADMIN_URL = `http://localhost:${PORTS.gateway}`;

/** Sign-in's settings for the e2e API, all fictional. */
export const AUTH = {
  secret: 'an-e2e-only-secret-of-more-than-thirty-two-characters',
} as const;

/** Deliberately fictional: the real name comes from each deployment's configuration. */
export const PLATFORM_NAME = 'Plataforma de ejemplo';

/** A stand-in for GlitchTip's ingest (fake-glitchtip.ts), one fictional project per app. */
export const GLITCHTIP_URL = `http://127.0.0.1:${PORTS.glitchtip}`;
export const DSNS = {
  web: `http://e2e-web@127.0.0.1:${PORTS.glitchtip}/1`,
  admin: `http://e2e-admin@127.0.0.1:${PORTS.glitchtip}/2`,
  api: `http://e2e-api@127.0.0.1:${PORTS.glitchtip}/3`,
} as const;

/** A stand-in for the platform's SMTP sender (fake-smtp.ts), and where tests read what it received. */
export const SMTP_URL = `smtp://127.0.0.1:${PORTS.smtp}`;
export const MAILBOX_URL = `http://127.0.0.1:${PORTS.mailbox}`;
/** The platform's sending address, fictional. */
export const MAIL_FROM = 'avisos@plataforma.example';

/** A stand-in for Plausible (fake-plausible.ts): the site script the web app serves, and the events API it relays to. */
export const PLAUSIBLE_URL = `http://127.0.0.1:${PORTS.plausible}`;

/**
 * The fictional seeds' public addresses (packages/db/seeds/seed.ts): browsers resolve `.localhost` names to this
 * machine, so these reach the web server on WEB_URL's port.
 */
export const PLATFORM_HOST = 'plataforma.localhost';
export const SEED_HOSTS = {
  /** Tenant ejemplo-a's canonical hostname. */
  canonical: 'ejemplo-a.localhost',
  /** A verified alias of ejemplo-a. */
  alias: 'alias-a.localhost',
  /** Registered for ejemplo-a, but never verified. */
  unverified: 'pendiente-a.localhost',
  /** The canonical hostname of an inactive tenant. */
  inactive: 'ejemplo-inactivo.localhost',
} as const;
/** Tenant ejemplo-a's home page. */
export const TENANT_URL = `http://${SEED_HOSTS.canonical}:${PORTS.web}`;
