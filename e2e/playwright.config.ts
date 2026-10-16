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
  PREVIEW_TOKEN,
  PREVIEW_TOKEN_HEADER,
  SMTP_URL,
  WEB_URL,
  WORKER_TOKEN,
  WORKER_URL,
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
// The admin's preview reads as its own role, which also sees elections in preview (PLAN R181).
const PREVIEW_DATABASE_URL = required('PREVIEW_DATABASE_URL');
// Sign-in runs as Better Auth's role, and what a signed-in user reads as the admin role (ADR-0002 §2).
const AUTH_DATABASE_URL = required('AUTH_DATABASE_URL');
const ADMIN_DATABASE_URL = required('ADMIN_DATABASE_URL');
// The worker extracts sources' text as its own role, which sees only the job it runs (PLAN R116).
const WORKER_DATABASE_URL = required('WORKER_DATABASE_URL');

// Runs against production builds (turbo builds the apps first), never against dev servers.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    // The preview's secret on every request, as the admin sends it (servers.ts): only the preview host reads it.
    extraHTTPHeaders: { [PREVIEW_TOKEN_HEADER]: PREVIEW_TOKEN },
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
        PREVIEW_TOKEN,
        // Only ejemplo-a has a Plausible script, in the seeds, counted on its canonical host: the other hosts show
        // it loads nowhere else (PLAN R135).
        PLAUSIBLE_URL,
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
        // The preview's data, for the web app's preview host, which sends the same secret.
        PREVIEW_DATABASE_URL,
        PREVIEW_TOKEN,
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
        // Extraction jobs go to the worker below, with each copy's bytes and the secret the two share.
        WORKER_URL,
        WORKER_TOKEN,
        // The right-of-reply form takes reports, as when the chart renders their daily anonymization (R149).
        REPORTS_ENABLED: 'true',
        // The public site's one replica, told when a site changes (R151).
        WEB_REVALIDATE_URL: WEB_URL,
      },
    },
    {
      name: 'worker',
      command: 'node dist/worker.js',
      cwd: '../apps/api',
      url: `${WORKER_URL}/healthz`,
      env: { PORT: String(PORTS.worker), LOG_LEVEL: 'warn', WORKER_DATABASE_URL, WORKER_TOKEN },
    },
    {
      name: 'admin',
      command: `pnpm exec next start --port ${PORTS.admin} --hostname 127.0.0.1`,
      cwd: '../apps/admin',
      url: `${ADMIN_SERVER_URL}/healthz`,
      // A site's preview (ADR-0005): fetched from the web app above, on its preview host, with the shared secret.
      env: { PLATFORM_NAME, SENTRY_DSN: DSNS.admin, API_URL, WEB_URL, PREVIEW_HOST, PREVIEW_TOKEN },
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
