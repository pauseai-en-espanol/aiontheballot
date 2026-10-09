import type { Dsn } from '@aiontheballot/observability/dsn';

import { privacyOptions } from '@aiontheballot/observability/privacy';
import { init, type NodeOptions } from '@sentry/node';
import { readFileSync } from 'node:fs';

/** `api@<version>`, read at runtime so it works from `src` (tests) and `dist` (the image). */
export const readRelease = (): string => {
  const packageJson = new URL('../package.json', import.meta.url);
  const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version: string };
  return `api@${version}`;
};

/**
 * Error tracking (ADR-0003 §7): events go straight to GlitchTip's in-cluster Service, scrubbed by the shared privacy
 * options. Fastify errors are captured through its diagnostics channel, 5xx only. Off when no DSN is configured.
 */
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
