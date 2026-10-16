import type { TenantDocumentKind } from '@aiontheballot/domain/public-home';

import { notFound } from 'next/navigation';

import { loadSitePage, type SitePageParams } from './site-page';

export type DocumentPage = 'privacy' | 'about';

const KINDS: Readonly<Record<DocumentPage, TenantDocumentKind>> = {
  privacy: 'privacy_policy',
  about: 'about_operator',
};

export const TITLES = { privacy: 'layout.privacy', about: 'layout.about' } as const;

/** A published policy text in the page's language, else the site's default one, which it then says it is in. */
export const documentOf = async (props: SitePageParams, page: DocumentPage) => {
  const loaded = await loadSitePage(props);
  const document = loaded.page.home.documents[KINDS[page]];
  if (!document) {
    notFound();
  }
  const { locale } = loaded;
  const { defaultLocale } = loaded.page.home.tenant;
  const textLocale = document.body[locale] ? locale : defaultLocale;
  return { loaded, document, textLocale, text: document.body[textLocale] ?? '' };
};
