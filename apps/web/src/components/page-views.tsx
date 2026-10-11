import { headers } from 'next/headers';

import { hostnameOf, readAnalytics } from '../analytics';
import { Analytics } from './analytics';

/**
 * Plausible, on a host the deployment gives a Plausible site (PLAN R83): on the home and the election pages, not in the
 * root layout, which a 404 renders in too (a missing page isn't a page view). The host picks the site and grants
 * nothing.
 */
export const PageViews = async () => {
  const hostname = hostnameOf((await headers()).get('host'));
  const counted =
    hostname !== undefined && readAnalytics(process.env)?.sites.has(hostname) === true;
  return counted ? <Analytics /> : null;
};
