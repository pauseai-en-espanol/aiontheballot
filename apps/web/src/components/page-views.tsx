import { headers } from 'next/headers';

import { hostnameOf } from '../analytics';
import { loadAnalytics } from '../tenant-data';
import { Analytics } from './analytics';

/**
 * Plausible, on a site's canonical host when the site has a Plausible script (PLAN R83, R135): on the home and the
 * election pages, not in the root layout, which a 404 renders in too (a missing page isn't a page view). The host picks
 * the site and grants nothing.
 */
export const PageViews = async () => {
  const hostname = hostnameOf((await headers()).get('host'));
  const counted = hostname !== undefined && (await loadAnalytics())?.sites.has(hostname) === true;
  return counted ? <Analytics /> : null;
};
