import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { redirect } from 'next/navigation';

import { ComingSoon } from '@/components/coming-soon';
import { PageViews } from '@/components/page-views';
import { pageMetadata } from '@/page-metadata';
import { isSignupOutcome } from '@/signup-outcomes';
import { FOOTER_LOGO, loadSitePage, type SitePageParams } from '@/site-page';

interface HomeProps extends SitePageParams {
  searchParams: Promise<{ aviso?: string | string[] }>;
}

const TARGET = { page: 'home' } as const;

/** The home's title, description and link preview, from the routing table (PLAN, social sharing). */
export const generateMetadata = async (props: HomeProps): Promise<Metadata> => {
  const loaded = await loadSitePage(props);
  const { home } = loaded.page;
  const t = getTranslator(loaded.locale);
  const local = (value: Record<string, string>) =>
    pickLocalized(value, loaded.locale, home.tenant.defaultLocale) ?? '';
  const operator = local(home.operator.displayName);
  return pageMetadata({
    ...loaded,
    target: TARGET,
    fullTitle: `${local(home.tenant.displayName)} · ${t('home.comingSoon')}`,
    description: t(`home.description.${home.tenant.methodologyKind}`, { operator }),
    // Shorter for link previews, which cut around 125 characters on phones; search results take the full sentence.
    shareDescription: t(`home.shareDescription.${home.tenant.methodologyKind}`, { operator }),
  });
};

/**
 * A tenant's home, reached only through the proxy's rewrite to /_tenant/{slug}/{locale} (the proxy answers 404 to
 * anyone asking for that path directly): the coming-soon page, with the signup list when the site offers it.
 */
const TenantHome = async (props: HomeProps) => {
  const loaded = await loadSitePage(props);
  const { locale, href, page } = loaded;
  const { home } = page;
  // An open site's home, and the preview host's, lead to the current election (public-site spec §3.2): 307, since the
  // current election changes. Coming soon, or with no public election yet, the home is the coming-soon page.
  const [current] = home.elections;
  if (loaded.site.mode !== 'coming-soon' && current) {
    redirect(href({ page: 'election', election: current.slug }));
  }
  const aviso = (await props.searchParams).aviso;
  return (
    <>
      <ComingSoon
        home={home}
        locale={locale}
        logos={{ onCanvas: loaded.logo(FOOTER_LOGO) }}
        links={loaded.links}
        languages={loaded.languages(TARGET)}
        signup={
          home.signups
            ? {
                action: href({ page: 'updates' }),
                privacyHref: href({ page: 'privacy' }),
                outcome: isSignupOutcome(aviso) ? aviso : undefined,
              }
            : undefined
        }
      />
      <PageViews />
    </>
  );
};

export default TenantHome;
