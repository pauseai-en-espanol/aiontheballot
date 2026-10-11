import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { headers } from 'next/headers';

import { hostnameOf, readAnalytics } from '@/analytics';
import { Analytics } from '@/components/analytics';
import { ComingSoon } from '@/components/coming-soon';
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
  const aviso = (await props.searchParams).aviso;
  // Plausible, on a host the deployment gives a Plausible site (PLAN R83). Here, not in the root layout, which a 404
  // renders in too: a missing page isn't a page view. The host picks the site and grants nothing.
  const hostname = hostnameOf((await headers()).get('host'));
  const counted =
    hostname !== undefined && readAnalytics(process.env)?.sites.has(hostname) === true;
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
      {counted && <Analytics />}
    </>
  );
};

export default TenantHome;
