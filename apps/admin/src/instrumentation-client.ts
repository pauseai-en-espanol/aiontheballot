import { browserOptions } from '@aiontheballot/observability/browser';
import { init } from '@sentry/nextjs';

// Browser error tracking (ADR-0003 §7), in production builds only. Events go to the relay on this host, never to
// GlitchTip directly, and the browser never sees the real DSN.
init({
  ...browserOptions,
  release: process.env.APP_RELEASE,
  enabled: process.env.NODE_ENV === 'production',
});
