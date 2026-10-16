import { installLazyReporting } from '@aiontheballot/observability/lazy';

// Browser error tracking (ADR-0003 §7), in production builds only. The SDK (about 20 KB) is loaded on the first
// error, so visitors who hit none download nothing. Events go to the relay on this host, never to GlitchTip directly.
if (process.env.NODE_ENV === 'production') {
  installLazyReporting(window, async () => (await import('./error-reporter')).createCapture());
}
