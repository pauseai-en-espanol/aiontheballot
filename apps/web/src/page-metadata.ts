import type { SitePage } from '@aiontheballot/domain/site-paths';
import type { Locale } from '@aiontheballot/i18n/messages';
import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { LINK_PREVIEW, SHARE_SIZES } from '@aiontheballot/og/sizes';

import type { SiteContext } from './site';
import type { TenantPage } from './tenant-data';

import { warmHomeImage } from './home-image';
import { homeCardContent, homeCardHash, imagePath, ogLocale, pageUrl } from './share';
import { pageCanonical } from './site';
import { siteIconPath, siteIconSource } from './site-icon';

type FoundPage = Extract<TenantPage, { kind: 'found' }>;

export interface PageMetadataOptions {
  page: FoundPage;
  slug: string;
  locale: Locale;
  site: SiteContext;
  target: SitePage;
  /** The page's own title; the site's name follows it. Without one, the title is the site's name. */
  title?: string;
  /** A title used as it is, in place of the page's title and the site's name. */
  fullTitle?: string;
  description: string;
  /** Shorter, for link previews, which cut around 125 characters on phones. Defaults to the description. */
  shareDescription?: string;
  /** Pages no search engine should list (a confirmation page): also never on the preview host. */
  noindex?: boolean;
  /**
   * The page's own link preview (R148): its image's path under the locale root, and the image in words. Without one,
   * the page shares the home's card.
   */
  share?: { path: string; alt: string };
}

/** The home's card as a page's link preview, rendered now in the background so it is ready for the crawler. */
const homePreview = (
  slug: string,
  locale: Locale,
  home: FoundPage['home'],
  base: string,
  open: boolean,
  name: string,
  warm: boolean,
): { path: string; alt: string } => {
  const t = getTranslator(locale);
  const card = homeCardContent(home, locale, base, open);
  const hash = homeCardHash(card, LINK_PREVIEW);
  if (warm) {
    warmHomeImage(slug, locale, LINK_PREVIEW, hash, card);
  }
  return { path: imagePath('home', LINK_PREVIEW, hash), alt: `${name}: ${t('home.question')}` };
};

/**
 * Everything a link preview needs (PLAN, social sharing), for any page: canonical and alternate addresses from the
 * routing table, Open Graph and Twitter tags with the site's share image, icons, and robots. The image is rendered now,
 * in the background, so it is ready when the crawler that fetched this page asks for it. Pages without a card of
 * their own (the always-on pages) share the home's.
 */
export const pageMetadata = async ({
  page: { home, tenant, base },
  slug,
  locale,
  site,
  target,
  title,
  fullTitle: givenTitle,
  description,
  shareDescription = description,
  noindex = false,
  share,
}: PageMetadataOptions): Promise<Metadata> => {
  const name = pickLocalized(home.tenant.displayName, locale, home.tenant.defaultLocale) ?? '';
  const fullTitle = givenTitle ?? (title ? `${title} · ${name}` : name);
  const url = pageCanonical(base, locale, tenant.defaultLocale, target);
  // Not warmed for the admin's preview (PLAN R181): no crawler reads it, and its data may name an election in preview.
  const preview =
    share ?? homePreview(slug, locale, home, base, tenant.open, name, site.mode !== 'preview');
  const image = {
    url: pageUrl(base, locale, tenant.defaultLocale, preview.path),
    ...SHARE_SIZES[LINK_PREVIEW],
    alt: preview.alt,
    type: 'image/png',
  };
  // Root-relative, from this host's root, like the logos: the same icons in every locale.
  const icon = await siteIconSource(slug, home);
  const png = (size: 16 | 32 | 180) => ({
    url: `${site.root}${siteIconPath(icon, size)}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
  });
  return {
    title: fullTitle,
    description,
    icons: { icon: [png(32), png(16)], shortcut: `${site.root}/favicon.ico`, apple: [png(180)] },
    manifest: `${site.root}/manifest.webmanifest`,
    alternates: {
      canonical: url,
      languages: Object.fromEntries([
        ...tenant.enabledLocales.map((l) => [
          l,
          pageCanonical(base, l, tenant.defaultLocale, target),
        ]),
        ['x-default', pageCanonical(base, tenant.defaultLocale, tenant.defaultLocale, target)],
      ]),
    },
    openGraph: {
      type: 'website',
      url,
      siteName: name,
      title: fullTitle,
      description: shareDescription,
      // Only for the tenant's own language (es_ES): `en_ES` is no Facebook locale, and og:locale:alternate means the
      // same URL in another language, while ours are separate pages (hreflang says so).
      // (Nor while an older API, mid-rollout, leaves the country out.)
      ...(locale === tenant.defaultLocale && home.tenant.countryCode
        ? { locale: ogLocale(locale, home.tenant.countryCode) }
        : {}),
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description: shareDescription,
      images: [image],
    },
    ...(noindex || !site.indexed ? { robots: { index: false, follow: false } } : {}),
  };
};
