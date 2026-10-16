import { timingSafeEqual } from 'node:crypto';

import { PREVIEW_TOKEN_HEADER } from './routing-proxy';
import { SITE_MODE_HEADER, type SiteMode, siteModeOf } from './site-mode';
import { previewAccess } from './tenant-data';

/**
 * The site's mode as the proxy set it, but the preview's only for a request that also carries the preview's secret,
 * compared in constant time (PLAN R181): in that mode pages and images read the API's preview data with the server's
 * own copy of the secret, so a header alone, were one ever to get past the proxy, shows the least instead.
 */
export const trustedSiteMode = (header: (name: string) => string | null): SiteMode => {
  const mode = siteModeOf(header(SITE_MODE_HEADER));
  if (mode !== 'preview') {
    return mode;
  }
  const sent = header(PREVIEW_TOKEN_HEADER);
  const token = previewAccess?.token;
  if (!sent || !token) {
    return 'coming-soon';
  }
  const a = Buffer.from(sent);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b) ? 'preview' : 'coming-soon';
};
