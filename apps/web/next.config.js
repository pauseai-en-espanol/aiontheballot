import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const { name, version } = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));

/**
 * The public site's Content Security Policy (public-site spec §7). ADR-0003 keeps nonces off the public site, so
 * scripts allow inline code: Next writes the page's data into inline scripts. Everything else is closed: nothing loads
 * from another host (fonts, the analytics script and the relays are the site's own), no frame may hold a page, and a
 * form posts only to the site. `pnpm dev` alone adds 'unsafe-eval', which React's development build needs; a
 * production build never has it.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/** On every response: pages, images, routes and build assets alike. */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  // No includeSubDomains: a tenant's hostname may sit under a domain it doesn't control alone. Browsers ignore it
  // over plain http (local runs).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

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
  headers: async () => [{ source: '/:path*', headers: SECURITY_HEADERS }],
  // The release that events are tagged with. A build fact, not deployment configuration, so it is inlined.
  env: { APP_RELEASE: `${name.replace('@aiontheballot/', '')}@${version}` },
  compiler: {
    // Errors only: drop the Sentry SDK's tracing and debug code from the bundles (no withSentryConfig, see
    // ADR-0003 §7).
    define: { __SENTRY_TRACING__: false, __SENTRY_DEBUG__: false },
  },
};

export default nextConfig;
