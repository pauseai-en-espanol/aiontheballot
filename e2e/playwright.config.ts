import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_URL,
  API_URL,
  DSNS,
  GLITCHTIP_URL,
  PLATFORM_HOST,
  PLATFORM_NAME,
  PORTS,
  WEB_URL,
} from './servers.js';

// The public site routes by data the API reads as aiontheballot_web, from a migrated and seeded database: CI sets the
// URL; locally it comes from .env (see .env.example).
if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}
const WEB_DATABASE_URL = process.env.WEB_DATABASE_URL;
if (!WEB_DATABASE_URL) {
  throw new Error(
    'WEB_DATABASE_URL is not set: run `pnpm db:up && pnpm db:migrate && pnpm db:seed` and set it in .env.',
  );
}

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
      name: 'web',
      // Bound like the production image (HOSTNAME=0.0.0.0): with 127.0.0.1, Next renames the host to localhost in the
      // proxy's URLs but not in its own, so it takes every tenant rewrite for an external one.
      command: `pnpm exec next start --port ${PORTS.web} --hostname 0.0.0.0`,
      cwd: '../apps/web',
      url: `${WEB_URL}/healthz`,
      env: { PLATFORM_NAME, SENTRY_DSN: DSNS.web, API_URL, PLATFORM_HOST },
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
        // Where `pnpm db:seed` put the seeds' file bytes (ADR-0004: the volume, here a folder).
        FILES_ROOT:
          process.env.FILES_ROOT || fileURLToPath(new URL('../.data/files', import.meta.url)),
      },
    },
    {
      name: 'admin',
      command: `pnpm exec next start --port ${PORTS.admin} --hostname 127.0.0.1`,
      cwd: '../apps/admin',
      url: `${ADMIN_URL}/healthz`,
      env: { PLATFORM_NAME, SENTRY_DSN: DSNS.admin },
    },
  ],
});
