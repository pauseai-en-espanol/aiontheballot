import type { SitePage } from '@aiontheballot/domain/site-paths';

import { BRAND_SLOTS } from '@aiontheballot/domain/public-home';
import { isLocale, type Locale } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import type { LanguageLink, SiteLinks } from './components/site-footer';

import { brandImagePath } from './brand-images';
import { pageHref, siteContext, type SiteContext } from './site';
import { loadTenantPage, type TenantPage } from './tenant-data';

export interface SitePageParams {
  params: Promise<{ slug: string; locale: string }>;
}

export interface LoadedSitePage {
  page: Extract<TenantPage, { kind: 'found' }>;
  slug: string;
  locale: Locale;
  site: SiteContext;
  /** A root-relative link to another of the site's pages, in this locale, on this host. */
  href: (target: SitePage) => string;
  /** The footer's links: the legal notice always, the policy texts once published. */
  links: SiteLinks;
  /** This page in each of the site's languages, for the language switch. */
  languages: (target: SitePage) => LanguageLink[];
  /** A brand image of the tenant's, by slot, as a URL on this host. */
  logo: (slot: string) => string | undefined;
}

/**
 * What every page of a tenant's site starts from: the tenant's public data, the mode and root the proxy set, and
 * the links the shared layout needs. An unknown tenant or locale is a 404; data the API can't give is an error.
 */
export const loadSitePage = async ({ params }: SitePageParams): Promise<LoadedSitePage> => {
  // At request time: API_URL is the deployment's, and the data changes without a build.
  await connection();
  const { slug, locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const page = await loadTenantPage(slug);
  if (page.kind === 'missing') {
    notFound();
  }
  if (page.kind === 'unavailable') {
    throw new Error(`The data of ${slug} is unavailable`);
  }
  const site = await siteContext();
  const { defaultLocale, enabledLocales } = page.tenant;
  const href = (target: SitePage) => pageHref(site.root, locale, defaultLocale, target);
  const { documents } = page.home;
  return {
    page,
    slug,
    locale,
    site,
    href,
    links: {
      legalNotice: href({ page: 'legalNotice' }),
      privacy: documents.privacy_policy ? href({ page: 'privacy' }) : undefined,
      about: documents.about_operator ? href({ page: 'about' }) : undefined,
    },
    languages: (target) =>
      enabledLocales.map((other) => ({
        locale: other,
        href: pageHref(site.root, other, defaultLocale, target),
      })),
    logo: (slot) => {
      const image = page.home.brand[slot];
      const path = image && brandImagePath(image);
      return path ? `${site.root}${path}` : undefined;
    },
  };
};

export const FOOTER_LOGO = BRAND_SLOTS.operatorLogoOnCanvas;
