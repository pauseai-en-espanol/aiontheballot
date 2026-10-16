import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';

import { pageMetadata } from './page-metadata';
import { loadSitePage, type SitePageParams } from './site-page';

export type TokenPage = 'confirm' | 'unsubscribe';

export interface TokenPageProps extends SitePageParams {
  searchParams: Promise<{ t?: string | string[]; r?: string | string[] }>;
}

export const tokenMetadata = async (props: TokenPageProps, page: TokenPage): Promise<Metadata> => {
  const loaded = await loadSitePage(props);
  const t = getTranslator(loaded.locale);
  const { home } = loaded.page;
  const site =
    pickLocalized(home.tenant.displayName, loaded.locale, home.tenant.defaultLocale) ?? '';
  return {
    ...(await pageMetadata({
      ...loaded,
      target: { page },
      title: t(`${page}.title`),
      description: t(`${page}.lead`, { site }),
      noindex: true,
    })),
    // The token is in this page's address: no other site hears of it.
    referrer: 'no-referrer',
  };
};
