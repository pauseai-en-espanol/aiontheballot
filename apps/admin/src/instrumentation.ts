import { readDsn } from '@aiontheballot/observability/dsn';
import { privacyOptions } from '@aiontheballot/observability/privacy';
import { captureRequestError, init } from '@sentry/nextjs';

// Server-side error tracking (ADR-0003 §7): events go straight to GlitchTip's in-cluster Service. Off unless
// SENTRY_DSN is set. An invalid one fails every request (health probe included), so new pods never become ready.
export const register = (): void => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const dsn = readDsn(process.env);
  init({
    ...privacyOptions,
    dsn: dsn?.value,
    enabled: dsn !== undefined,
    release: process.env.APP_RELEASE,
  });
};

export const onRequestError = captureRequestError;
