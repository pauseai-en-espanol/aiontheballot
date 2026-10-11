import { type SitePage, sitePath } from '@aiontheballot/domain/site-paths';
import { headers } from 'next/headers';

import { SITE_MODE_HEADER, SITE_ROOT_HEADER, type SiteMode, siteModeOf } from './site-mode';

/** What the proxy told this page (public-site spec §2): the site's mode, and where its root is on this host. */
export interface SiteContext {
  mode: SiteMode;
  root: string;
}

export const siteContext = async (): Promise<SiteContext> => {
  const list = await headers();
  const root = list.get(SITE_ROOT_HEADER) ?? '';
  return {
    mode: siteModeOf(list.get(SITE_MODE_HEADER)),
    // Only what the proxy sets: nothing, or `/` and a slug.
    root: /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.test(root) ? root : '',
  };
};

/** The locale's prefix: none for the site's default locale, `/en` for another. */
export const localePrefix = (locale: string, defaultLocale: string): string =>
  locale === defaultLocale ? '' : `/${locale}`;

/**
 * A page's root-relative link on this host, in the site's words: `/aviso-legal`, `/en/aviso-legal`,
 * `/ejemplo-a/aviso-legal` on the platform or preview host. The home is the root itself, with no trailing slash.
 */
export const pageHref = (
  root: string,
  locale: string,
  defaultLocale: string,
  target: SitePage,
): string => {
  const path = sitePath(defaultLocale, target);
  const href = `${root}${localePrefix(locale, defaultLocale)}${path === '/' ? '' : path}`;
  return href === '' ? '/' : href;
};

/**
 * A page's canonical address: the tenant's canonical base (never the Host header), its locale, its path. The home is
 * the base itself, as the share images print it.
 */
export const pageCanonical = (
  base: string,
  locale: string,
  defaultLocale: string,
  target: SitePage,
): string => {
  const path = sitePath(defaultLocale, target);
  return `${base}${localePrefix(locale, defaultLocale)}${path === '/' ? '' : path}`;
};
