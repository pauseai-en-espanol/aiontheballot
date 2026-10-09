import type { Integration } from '@sentry/core';

import { privacyOptions } from './privacy.js';

/** The relay route on each Next app's own host. The leading underscore keeps it clear of election slugs. */
export const ERROR_RELAY_PATH = '/_relay/errors';

/**
 * The browser never sees the real DSN. It sends envelopes to the relay, which replaces this placeholder with the
 * app's own DSN (held server-side) and forwards them in-cluster, so neither the key nor GlitchTip's host reaches
 * the page.
 */
export const RELAY_PLACEHOLDER_DSN = 'https://relay@relay.invalid/0';

/** Shared by every browser SDK setup: privacy settings, and everything goes through the relay. */
export const relayOptions = {
  ...privacyOptions,
  dsn: RELAY_PLACEHOLDER_DSN,
  tunnel: ERROR_RELAY_PATH,
};

// Errors only. A session envelope on every page view would turn traffic into GlitchTip traffic.
const DROPPED_INTEGRATIONS = new Set(['BrowserSession', 'BrowserTracing']);

/** For a full SDK `init` (the admin): its default integrations, minus sessions and tracing. */
export const browserOptions = {
  ...relayOptions,
  integrations: (defaults: Integration[]): Integration[] =>
    defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
};
