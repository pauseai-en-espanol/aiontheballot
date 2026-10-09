import { getTranslator, isLocale } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';
import { notFound } from 'next/navigation';

interface TenantPageProps {
  params: Promise<{ slug: string; locale: string; path?: string[] }>;
}

/**
 * A tenant's home, reached only through the proxy's rewrite to /_tenant/{slug}/{locale}/… (the proxy answers 404 to
 * anyone asking for that path directly). The public site itself is M3; until then only the home exists.
 */
const TenantHome = async ({ params }: TenantPageProps) => {
  const { locale, path } = await params;
  if (!isLocale(locale) || (path?.length ?? 0) > 0) {
    notFound();
  }
  const t = getTranslator(locale);
  return (
    <main
      className={css({
        maxWidth: '65ch',
        marginInline: 'auto',
        paddingInline: '4',
        paddingBlock: '16',
      })}
    >
      <h1 className={css({ fontSize: '2xl', fontWeight: 'semibold' })}>{t('home.comingSoon')}</h1>
    </main>
  );
};

export default TenantHome;
