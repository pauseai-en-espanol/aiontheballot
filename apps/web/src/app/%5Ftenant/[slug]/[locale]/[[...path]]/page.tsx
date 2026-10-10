import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator, isLocale } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { ComingSoon } from '@/components/coming-soon';
import { createHomeLoader } from '@/home-data';

interface TenantPageProps {
  params: Promise<{ slug: string; locale: string; path?: string[] }>;
}

const loadHome = createHomeLoader({ apiUrl: process.env.API_URL });

/** The home's data, or a 404 for any other path or an unknown locale or tenant. */
const homeFor = async ({ params }: TenantPageProps) => {
  // At request time: API_URL is the deployment's, and the data changes without a build.
  await connection();
  const { slug, locale, path } = await params;
  if (!isLocale(locale) || (path?.length ?? 0) > 0) {
    notFound();
  }
  const result = await loadHome(slug);
  if (result.kind === 'missing') {
    notFound();
  }
  if (result.kind === 'unavailable') {
    throw new Error(`The home data of ${slug} is unavailable`);
  }
  return { home: result.home, locale };
};

export const generateMetadata = async (props: TenantPageProps): Promise<Metadata> => {
  const { home, locale } = await homeFor(props);
  const t = getTranslator(locale);
  const local = (value: Record<string, string>) =>
    pickLocalized(value, locale, home.tenant.defaultLocale) ?? '';
  return {
    title: `${local(home.tenant.displayName)} · ${t('home.comingSoon')}`,
    description: t(`home.description.${home.tenant.methodologyKind}`, {
      operator: local(home.operator.displayName),
    }),
  };
};

/**
 * A tenant's home, reached only through the proxy's rewrite to /_tenant/{slug}/{locale}/… (the proxy answers 404 to
 * anyone asking for that path directly). The public site itself is M3; until then the home is the coming-soon page.
 */
const TenantHome = async (props: TenantPageProps) => {
  const { home, locale } = await homeFor(props);
  return <ComingSoon home={home} locale={locale} />;
};

export default TenantHome;
