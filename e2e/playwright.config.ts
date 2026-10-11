import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_SERVER_URL,
  ADMIN_URL,
  API_URL,
  AUTH,
  DSNS,
  GLITCHTIP_URL,
  MAIL_FROM,
  MAILBOX_URL,
  PLATFORM_HOST,
  PLATFORM_NAME,
  PLAUSIBLE_URL,
  PORTS,
  PREVIEW_HOST,
  SEED_HOSTS,
  SMTP_URL,
  WEB_URL,
} from './servers.js';

// The public site routes by data the API reads as aiontheballot_web, from a migrated and seeded database: CI sets the
// URL; locally it comes from .env (see .env.example).
if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set: run \`pnpm db:up && pnpm db:migrate && pnpm db:seed\` and set it in .env (see .env.example).`,
    );
  }
  return value;
};
const WEB_DATABASE_URL = required('WEB_DATABASE_URL');
// Sign-in runs as Better Auth's role, and what a signed-in user reads as the admin role (ADR-0002 §2).
const AUTH_DATABASE_URL = required('AUTH_DATABASE_URL');
const ADMIN_DATABASE_URL = required('ADMIN_DATABASE_URL');

// Runs against production builds (turbo builds the apps first), never against dev servers.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'glitchtip',
      command: 'node fake-glitchtip.ts',
      url: `${GLITCHTIP_URL}/healthz`,
      env: { PORT: String(PORTS.glitchtip) },
    },
    {
      name: 'plausible',
      command: 'node fake-plausible.ts',
      url: `${PLAUSIBLE_URL}/healthz`,
      env: { PORT: String(PORTS.plausible) },
    },
    {
      name: 'smtp',
      command: 'node fake-smtp.ts',
      url: `${MAILBOX_URL}/healthz`,
      env: { PORT: String(PORTS.mailbox), SMTP_PORT: String(PORTS.smtp) },
    },
    {
      name: 'web',
      // Bound like the production image (HOSTNAME=0.0.0.0): with 127.0.0.1, Next renames the host to localhost in the
      // proxy's URLs but not in its own, so it takes every tenant rewrite for an external one.
      command: `pnpm exec next start --port ${PORTS.web} --hostname 0.0.0.0`,
      cwd: '../apps/web',
      url: `${WEB_URL}/healthz`,
      env: {
        PLATFORM_NAME,
        SENTRY_DSN: DSNS.web,
        API_URL,
        PLATFORM_HOST,
        PREVIEW_HOST,
        // Only ejemplo-a's canonical host has a Plausible site, so the other hosts show it loads nowhere else.
        PLAUSIBLE_URL,
        PLAUSIBLE_SITES: JSON.stringify({ [SEED_HOSTS.canonical]: 'pa-e2e.js' }),
      },
    },
    {
      name: 'api',
      command: 'node dist/server.js',
      cwd: '../apps/api',
      url: `${API_URL}/healthz`,
      env: {
        HOST: '127.0.0.1',
        PORT: String(PORTS.api),
        LOG_LEVEL: 'warn',
        SENTRY_DSN: DSNS.api,
        WEB_DATABASE_URL,
        AUTH_DATABASE_URL,
        ADMIN_DATABASE_URL,
        BETTER_AUTH_SECRET: AUTH.secret,
        ADMIN_ORIGIN: ADMIN_URL,
        PLATFORM_NAME,
        // The platform's sender (PLAN R115), a stand-in that keeps what it receives.
        SMTP_URL,
        MAIL_FROM,
        // Where `pnpm db:seed` put the seeds' file bytes (ADR-0004: the volume, here a folder).
        FILES_ROOT:
          process.env.FILES_ROOT || fileURLToPath(new URL('../.data/files', import.meta.url)),
      },
    },
    {
      name: 'admin',
      command: `pnpm exec next start --port ${PORTS.admin} --hostname 127.0.0.1`,
      cwd: '../apps/admin',
      url: `${ADMIN_SERVER_URL}/healthz`,
      env: { PLATFORM_NAME, SENTRY_DSN: DSNS.admin, API_URL },
    },
    {
      // The admin host as browsers reach it: /api to the API, the rest to the admin (fake-gateway.ts).
      name: 'gateway',
      command: 'node fake-gateway.ts',
      url: `${ADMIN_URL}/healthz`,
      env: {
        PORT: String(PORTS.gateway),
        API_UPSTREAM: API_URL,
        ADMIN_UPSTREAM: ADMIN_SERVER_URL,
      },
    },
  ],
});
