import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';

import type { SitePageParams } from './site-page';

import { documentOf, type DocumentPage, TITLES } from './document-data';
import { pageMetadata } from './page-metadata';

export const documentMetadata = async (
  props: SitePageParams,
  page: DocumentPage,
): Promise<Metadata> => {
  const { loaded, text } = await documentOf(props, page);
  const t = getTranslator(loaded.locale);
  return pageMetadata({
    ...loaded,
    target: { page },
    title: t(TITLES[page]),
    // The text's opening, flattened: what a search result shows.
    description: text
      .replaceAll(/[#*_>`[\]()-]+/gu, ' ')
      .replaceAll(/\s+/gu, ' ')
      .trim()
      .slice(0, 160),
  });
};
