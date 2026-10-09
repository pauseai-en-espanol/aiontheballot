import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const { name, version } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Trace dependencies from the monorepo root so the standalone output includes workspace packages.
  outputFileTracingRoot: join(appDir, '../..'),
  poweredByHeader: false,
  reactStrictMode: true,
  // The release that events are tagged with. A build fact, not deployment configuration, so it is inlined.
  env: { APP_RELEASE: `${name.replace('@aiontheballot/', '')}@${version}` },
  compiler: {
    // Errors only: drop the Sentry SDK's tracing and debug code from the bundles (no withSentryConfig, see
    // ADR-0003 §7).
    define: { __SENTRY_TRACING__: false, __SENTRY_DEBUG__: false },
  },
};

export default nextConfig;
