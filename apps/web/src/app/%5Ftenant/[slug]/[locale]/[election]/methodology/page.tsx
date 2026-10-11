import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { RATING_SCALES } from '@aiontheballot/domain/methodology';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { RatingBadge } from '@/components/rating';
import {
  type ElectionPageParams,
  type LoadedElectionPage,
  loadElectionPage,
} from '@/election-page';
import { methodologyOf } from '@/election-view';
import { localText } from '@/local-text';
import { renderMarkdown } from '@/markdown';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing, prose } from '@/styles';

/** What the ratings say, in the words of the methodology's kind, as its scale below. */
const lead = (page: LoadedElectionPage): string => {
  const t = getTranslator(page.locale);
  const { home } = page.page;
  const { kind, owner } = methodologyOf(page.election, home.tenant.methodologyKind);
  if (kind === 'descriptive') {
    return t('methodologyPage.descriptive');
  }
  return owner
    ? t('methodologyPage.demands', {
        owner: pickLocalized(owner.name, page.locale, home.tenant.defaultLocale) ?? '',
      })
    : t('methodologyPage.demandsUnnamed');
};

export const generateMetadata = async (props: ElectionPageParams): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const t = getTranslator(page.locale);
  return pageMetadata({
    ...page,
    target: { page: 'methodology', election: page.election.election.slug },
    title: t('methodologyPage.title'),
    description: lead(page),
  });
};

/**
 * An election's methodology (public-site spec §5.3): what the ratings mean and whose demands they measure, the
 * operator's text (Markdown: no HTML, no images), and the people who reviewed it.
 */
const Methodology = async (props: ElectionPageParams) => {
  const page = await loadElectionPage(props);
  const { locale } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const { methodology } = page.election;
  const { kind, owner } = methodologyOf(page.election, page.page.home.tenant.methodologyKind);
  const body = methodology ? localText(methodology.body, locale, defaultLocale) : undefined;
  return (
    <ElectionFrame
      page={page}
      target={{ page: 'methodology', election: page.election.election.slug }}
      title={t('methodologyPage.title')}
    >
      <p className={css({ fontSize: '19px', maxWidth: '65ch' })}>
        {lead(page)}{' '}
        {owner?.url && (
          <a href={owner.url} className={cx(focusRing, css({ textDecoration: 'underline' }))}>
            {owner.url}
          </a>
        )}
      </p>
      <section aria-labelledby="valoraciones" className={css({ marginBlock: '32px' })}>
        <h2
          id="valoraciones"
          className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '12px' })}
        >
          {t('methodologyPage.scale')}
        </h2>
        <ul
          className={css({
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            fontSize: '18px',
          })}
        >
          {[...RATING_SCALES[kind], 'pending' as const].map((rating) => (
            <li key={rating}>
              <RatingBadge rating={rating} label={ratingLabel(locale, rating)} />
            </li>
          ))}
        </ul>
        <p className={css({ marginTop: '12px', fontSize: '17px', maxWidth: '65ch' })}>
          {t('methodologyPage.pending')}
        </p>
      </section>
      {body && body.text !== '' && (
        <div
          lang={body.lang}
          className={prose}
          // Rendered from Markdown with raw HTML off and only http(s) and mailto links (markdown.ts).
          // oxlint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderMarkdown(body.text) }}
        />
      )}
      {methodology && methodology.reviewers.length > 0 && (
        <section aria-labelledby="revision-externa" className={css({ marginTop: '40px' })}>
          <h2
            id="revision-externa"
            className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('methodologyPage.reviewers')}
          </h2>
          <p className={css({ fontSize: '17px' })}>{t('methodologyPage.reviewersLead')}</p>
          <ul
            className={css({
              listStyle: 'disc',
              paddingInlineStart: '1.5em',
              marginTop: '8px',
              fontSize: '17px',
            })}
          >
            {methodology.reviewers.map((reviewer) => (
              <li key={`${reviewer.name}-${reviewer.affiliation}`}>
                {t('methodologyPage.reviewer', {
                  name: reviewer.name,
                  affiliation: reviewer.affiliation,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </ElectionFrame>
  );
};

export default Methodology;
