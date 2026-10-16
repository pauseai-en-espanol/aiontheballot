import type { Dsn } from '@aiontheballot/observability/dsn';

import { privacyOptions } from '@aiontheballot/observability/privacy';
import { fastifyIntegration, init, type NodeOptions } from '@sentry/node';
import { readFileSync } from 'node:fs';

/** `api@<version>`, read at runtime so it works from `src` (tests) and `dist` (the image). */
export const readRelease = (): string => {
  const packageJson = new URL('../package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string };
  return `api@${version}`;
};

/**
 * Error tracking (ADR-0003 §7): events go straight to the DSN's address, scrubbed by the shared privacy
 * options. Fastify errors are captured through its diagnostics channel, 5xx only, except in the API server
 * (`API_TRACKING`). Off when no DSN is configured.
 */
/**
 * The API server's: its root error handler (app.ts) reports each fault itself, one with a code (a database's or Node's)
 * by that code only, so Sentry's Fastify integration, which would report the error as thrown, message and all, a
 * second time, reports none (PLAN R208). The fetcher and the worker have no such handler, and keep it.
 */
export const API_TRACKING: Partial<NodeOptions> = {
  integrations: [fastifyIntegration({ shouldHandleError: () => false })],
};

export const initErrorTracking = (
  dsn: Dsn | undefined,
  overrides: Partial<NodeOptions> = {},
): void => {
  init({
    ...privacyOptions,
    dsn: dsn?.value,
    enabled: dsn !== undefined,
    release: readRelease(),
    ...overrides,
  });
};
