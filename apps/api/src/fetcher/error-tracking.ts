import type { NodeOptions } from '@sentry/node';

/**
 * The fetcher's error tracking (ADR-0007 §6), over the shared privacy options: nothing of the platform goes with a
 * request to a party's site or to the archive (no `sentry-trace` or `baggage` header, which would name its release and
 * its project's key), and no breadcrumb records one, whose URL is a member's: its faults are reported by their class
 * only.
 */
export const FETCHER_TRACKING: Partial<NodeOptions> = {
  initialScope: { tags: { component: 'fetcher' } },
  tracePropagationTargets: [],
  beforeBreadcrumb: () => null,
};
