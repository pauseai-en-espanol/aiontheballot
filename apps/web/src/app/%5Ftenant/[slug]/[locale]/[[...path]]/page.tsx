import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { BRAND_SLOTS } from '@aiontheballot/domain/public-home';
import { getTranslator, isLocale } from '@aiontheballot/i18n/messages';
import { LINK_PREVIEW, SHARE_SIZES } from '@aiontheballot/og/sizes';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { brandImagePath } from '@/brand-images';
import { ComingSoon } from '@/components/coming-soon';
import { warmHomeImage } from '@/home-image';
import { homeCardContent, homeCardHash, imagePath, ogLocale, pageUrl } from '@/share';
import { loadTenantPage } from '@/tenant-data';

interface TenantPageProps {
  params: Promise<{ slug: string; locale: string; path?: string[] }>;
}

/** The home's data, or a 404 for any other path or an unknown locale or tenant. */
const homeFor = async ({ params }: TenantPageProps) => {
  // At request time: API_URL is the deployment's, and the data changes without a build.
  await connection();
  const { slug, locale, path } = await params;
  if (!isLocale(locale) || (path?.length ?? 0) > 0) {
    notFound();
  }
  const page = await loadTenantPage(slug);
  if (page.kind === 'missing') {
    notFound();
  }
  if (page.kind === 'unavailable') {
    throw new Error(`The home data of ${slug} is unavailable`);
  }
  return { ...page, slug, locale };
};

/**
 * Everything a link preview needs (PLAN, social sharing): canonical and alternate addresses from the routing table,
 * and Open Graph and Twitter tags with the share image. The image is rendered now, in the background, so it is
 * ready when the crawler that fetched this page asks for it.
 */
export const generateMetadata = async (props: TenantPageProps): Promise<Metadata> => {
  const { home, tenant, base, slug, locale } = await homeFor(props);
  const t = getTranslator(locale);
  const local = (value: Record<string, string>) =>
    pickLocalized(value, locale, home.tenant.defaultLocale) ?? '';
  const name = local(home.tenant.displayName);
  const title = `${name} · ${t('home.comingSoon')}`;
  const operator = local(home.operator.displayName);
  const description = t(`home.description.${home.tenant.methodologyKind}`, { operator });
  // Shorter for link previews, which cut around 125 characters on phones; search results take the full sentence.
  const shareDescription = t(`home.shareDescription.${home.tenant.methodologyKind}`, { operator });
  const url = pageUrl(base, locale, tenant.defaultLocale);
  const card = homeCardContent(home, locale, base);
  const hash = homeCardHash(card, LINK_PREVIEW);
  warmHomeImage(slug, locale, LINK_PREVIEW, hash, card);
  const image = {
    url: pageUrl(base, locale, tenant.defaultLocale, imagePath('home', LINK_PREVIEW, hash)),
    ...SHARE_SIZES[LINK_PREVIEW],
    alt: `${name}: ${t('home.question')}`,
    type: 'image/png',
  };
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: Object.fromEntries([
        ...tenant.enabledLocales.map((l) => [l, pageUrl(base, l, tenant.defaultLocale)]),
        ['x-default', pageUrl(base, tenant.defaultLocale, tenant.defaultLocale)],
      ]),
    },
    openGraph: {
      type: 'website',
      url,
      siteName: name,
      title,
      description: shareDescription,
      // Only for the tenant's own language (es_ES): `en_ES` is no Facebook locale, and og:locale:alternate means the
      // same URL in another language, while ours are separate pages (hreflang says so).
      // (Nor while an older API, mid-rollout, leaves the country out.)
      ...(locale === tenant.defaultLocale && home.tenant.countryCode
        ? { locale: ogLocale(locale, home.tenant.countryCode) }
        : {}),
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description: shareDescription, images: [image] },
  };
};

/**
 * A tenant's home, reached only through the proxy's rewrite to /_tenant/{slug}/{locale}/… (the proxy answers 404 to
 * anyone asking for that path directly). The public site itself is M3; until then the home is the coming-soon page.
 */
const TenantHome = async (props: TenantPageProps) => {
  const { home, locale, base } = await homeFor(props);
  // Root-relative, from the canonical base's path: `/brand/…`, or `/{slug}/brand/…` on the platform host.
  const root = new URL(base).pathname.replace(/\/$/, '');
  const logo = (slot: string) => {
    const image = home.brand[slot];
    const path = image && brandImagePath(image);
    return path ? `${root}${path}` : undefined;
  };
  return (
    <ComingSoon
      home={home}
      locale={locale}
      logos={{
        onAccent: logo(BRAND_SLOTS.operatorLogoOnAccent),
        onCanvas: logo(BRAND_SLOTS.operatorLogoOnCanvas),
      }}
    />
  );
};

export default TenantHome;
