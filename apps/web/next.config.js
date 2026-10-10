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
  // Share images (ADR-0003 §8): the native rasteriser and satori load from node_modules at runtime rather than
  // being bundled, so the standalone output traces the binary. (The fonts are embedded in @aiontheballot/og.)
  serverExternalPackages: ['@resvg/resvg-js', 'satori'],
  // Metadata in <head> for every client, not streamed into the body: crawlers Next doesn't recognise (Mastodon,
  // Bluesky, Pinterest…) read only the head. The page's data is cached, so waiting for it costs little.
  htmlLimitedBots: /.*/,
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
