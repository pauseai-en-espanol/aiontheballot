import type { Capture } from '@aiontheballot/observability/lazy';

import { relayOptions } from '@aiontheballot/observability/browser';
import {
  BrowserClient,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  eventFiltersIntegration,
  getCurrentScope,
  httpContextIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
} from '@sentry/browser';

/**
 * Loaded only after the first error (see instrumentation-client.ts). A minimal client: no global handlers (the lazy
 * listeners report instead), no breadcrumbs, no sessions, no tracing.
 */
export const createCapture = (): Capture => {
  const client = new BrowserClient({
    ...relayOptions,
    release: process.env.APP_RELEASE,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: [
      eventFiltersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
    ],
  });
  getCurrentScope().setClient(client);
  client.init();
  return (error, mechanism) => {
    captureException(error, { mechanism });
  };
};
