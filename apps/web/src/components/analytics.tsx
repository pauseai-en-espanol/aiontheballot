'use client';

import { useEffect } from 'react';

import { ANALYTICS_EVENT_PATH, ANALYTICS_SCRIPT_PATH } from '../analytics-paths';

interface PlausibleQueue {
  (...args: unknown[]): void;
  q?: unknown[][];
  o?: Record<string, unknown>;
  init?: (options?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    plausible?: PlausibleQueue;
  }
}

/**
 * Loads the tenant's Plausible script from the site's own host and points its events at the site's relay (PLAN R83):
 * Plausible's installation snippet, run from the bundle rather than inline, with `endpoint` set as its proxy guides
 * say. Rendered only for a host with a Plausible site. The script follows client-side navigation itself.
 */
export const Analytics = () => {
  useEffect(() => {
    if (window.plausible || document.querySelector(`script[src="${ANALYTICS_SCRIPT_PATH}"]`)) {
      return;
    }
    const plausible: PlausibleQueue = (...args: unknown[]) => {
      (plausible.q ??= []).push(args);
    };
    plausible.init = (options = {}) => {
      plausible.o = options;
    };
    window.plausible = plausible;
    plausible.init({ endpoint: ANALYTICS_EVENT_PATH });
    const script = document.createElement('script');
    script.async = true;
    script.src = ANALYTICS_SCRIPT_PATH;
    document.head.append(script);
  }, []);
  return null;
};
