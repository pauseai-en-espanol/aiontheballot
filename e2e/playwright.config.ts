import { defineConfig, devices } from '@playwright/test';

import { ADMIN_URL, API_URL, PLATFORM_NAME, PORTS, WEB_URL } from './servers.js';

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
      name: 'web',
      command: `pnpm exec next start --port ${PORTS.web} --hostname 127.0.0.1`,
      cwd: '../apps/web',
      url: `${WEB_URL}/healthz`,
      env: { PLATFORM_NAME },
    },
    {
      name: 'api',
      command: 'node dist/server.js',
      cwd: '../apps/api',
      url: `${API_URL}/healthz`,
      env: { HOST: '127.0.0.1', PORT: String(PORTS.api), LOG_LEVEL: 'warn' },
    },
    {
      name: 'admin',
      command: `pnpm exec next start --port ${PORTS.admin} --hostname 127.0.0.1`,
      cwd: '../apps/admin',
      url: `${ADMIN_URL}/healthz`,
      env: { PLATFORM_NAME },
    },
  ],
});
