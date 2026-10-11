import { getTranslator } from '@aiontheballot/i18n/messages';
import { css } from '@styled-system/css';

import type { SitePageParams } from './site-page';

import { SiteFrame } from './components/site-frame';
import { documentOf, type DocumentPage, TITLES } from './document-data';
import { renderMarkdown } from './markdown';
import { pageTitle, prose } from './styles';

/**
 * A policy text the operator wrote and published (privacy policy, about the operator): its latest version, rendered
 * from Markdown (no HTML, no images), with its version and date. Not published yet: a 404, and no link to it.
 */
export const DocumentPageView = async ({
  props,
  page,
}: {
  props: SitePageParams;
  page: DocumentPage;
}) => {
  const { loaded, document, textLocale, text } = await documentOf(props, page);
  const t = getTranslator(loaded.locale);
  return (
    <SiteFrame site={loaded} target={{ page }}>
      <h1 className={pageTitle}>{t(TITLES[page])}</h1>
      <div
        lang={textLocale}
        className={prose}
        // Rendered from Markdown with raw HTML off and only http(s) and mailto links (markdown.ts).
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
      />
      <p className={css({ marginTop: '40px', fontSize: '15px', color: 'fg.muted' })}>
        {t('documents.version', {
          version: document.version,
          date: new Date(document.publishedAt),
        })}
      </p>
    </SiteFrame>
  );
};
