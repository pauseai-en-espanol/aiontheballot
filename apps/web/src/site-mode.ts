import { INTERNAL_PREFIX } from '@aiontheballot/domain/routing';

/**
 * What a tenant's site shows (public-site spec §2): coming soon until it is open, then every page; on the preview
 * host, every page, never indexed. The proxy decides and tells the page in request headers it always sets itself.
 */
export type SiteMode = 'coming-soon' | 'open' | 'preview';

/** The site's mode, set by the proxy on every page it serves, over anything a client sent. */
export const SITE_MODE_HEADER = 'x-aiontheballot-site';
/** Where the tenant's root is on the host served, for links between its pages: `` or `/{slug}`. */
export const SITE_ROOT_HEADER = 'x-aiontheballot-root';
/** The page's language, for `<html lang>`. */
export const SITE_LOCALE_HEADER = 'x-aiontheballot-locale';

/** `OPEN_SITES`: the tenant slugs whose sites are open, comma-separated. Anything else stays coming soon. */
export const readOpenSites = (value: string | undefined): ReadonlySet<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter((slug) => slug !== ''),
  );

/**
 * The app routes a coming-soon site serves, by first segment under its root: the home, the always-on pages (spec §3.3)
 * and what they load. Election pages wait until the site opens.
 */
const COMING_SOON_ROUTES: ReadonlySet<string> = new Set([
  'legal-notice',
  'privacy',
  'about',
  'updates',
  'brand',
  'og',
  'favicon.ico',
  'manifest.webmanifest',
  'sitemap.xml',
  'robots.txt',
]);

/** Whether a coming-soon site serves this internal path (`/_tenant/{slug}/{locale}/…`). */
export const servedWhileComingSoon = (
  internalPath: string,
  slug: string,
  locale: string,
): boolean => {
  const rest = internalPath.slice(`${INTERNAL_PREFIX}/${slug}/${locale}`.length);
  // The home is the root itself; any other path names a route by its first segment, never an empty one (`//x`).
  if (rest === '') {
    return true;
  }
  const [, first = ''] = rest.split('/');
  return first !== '' && COMING_SOON_ROUTES.has(first);
};

/** A mode a page can trust: the proxy's, else coming soon, the mode that shows least. */
export const siteModeOf = (value: string | null): SiteMode =>
  value === 'open' || value === 'preview' ? value : 'coming-soon';
