import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';
import { notFound } from 'next/navigation';

import { ElectionFrame } from '@/components/election-frame';
import { PartyMark } from '@/components/party-identity';
import { RatingBadge } from '@/components/rating';
import { RatingLegend } from '@/components/rating-legend';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { methodologyOf } from '@/election-view';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing } from '@/styles';

interface CriterionProps extends ElectionPageParams {
  params: Promise<{ slug: string; locale: string; election: string; criterion: string }>;
}

const criterionPage = async (props: CriterionProps) => {
  const page = await loadElectionPage(props);
  const { criterion: slug } = await props.params;
  const criterion = page.election.criteria.find((c) => c.slug === slug);
  if (!criterion) {
    notFound();
  }
  return { page, criterion };
};

export const generateMetadata = async (props: CriterionProps): Promise<Metadata> => {
  const { page, criterion } = await criterionPage(props);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  return pageMetadata({
    ...page,
    share: electionPageShare(page, { view: 'criterion', criterion: criterion.slug })?.preview,
    target: { page: 'criterion', election: page.election.election.slug, criterion: criterion.slug },
    title: localText(criterion.title, page.locale, defaultLocale).text,
    description: localText(criterion.description, page.locale, defaultLocale).text.slice(0, 160),
  });
};

/** A criterion's page (public-site spec §5.2): what it asks, and every party's rating on it. */
const Criterion = async (props: CriterionProps) => {
  const { page, criterion } = await criterionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const { election, parties } = page.election;
  // A colour's space beside every name once any party has one, so names stay in line; none at all otherwise (R180).
  const marked = parties.some((party) => Boolean(party.colour || party.logo));
  const title = text(criterion.title);
  const description = text(criterion.description);
  return (
    <ElectionFrame
      page={page}
      share={electionPageShare(page, { view: 'criterion', criterion: criterion.slug })}
      target={{ page: 'criterion', election: election.slug, criterion: criterion.slug }}
      title={<span lang={title.lang}>{title.text}</span>}
    >
      <p
        lang={description.lang}
        className={css({ fontSize: '19px', maxWidth: '70ch', whiteSpace: 'pre-line' })}
      >
        {description.text}
      </p>
      <RatingLegend
        locale={locale}
        kind={methodologyOf(page.election, page.page.home.tenant.methodologyKind).kind}
        methodologyHref={href({ page: 'methodology', election: election.slug })}
      />
      <h2 className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '12px' })}>
        {t('criterionPage.ratings')}
      </h2>
      <ul className={css({ listStyle: 'none', maxWidth: '72ch' })}>
        {parties.map((party) => {
          const cell = page.cell(party, criterion);
          const name = text(party.name);
          const summary = cell.current?.summary ? text(cell.current.summary) : undefined;
          return (
            <li
              key={party.id}
              className={css({
                borderTop: '1px solid',
                borderColor: 'border.subtle',
                paddingBlock: '16px',
              })}
            >
              <h3 className={css({ fontSize: '19px', fontWeight: '700' })}>
                <a
                  href={href({
                    page: 'cell',
                    election: election.slug,
                    party: party.slug,
                    criterion: criterion.slug,
                  })}
                  className={cx(
                    focusRing,
                    css({
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      textDecoration: 'underline',
                    }),
                  )}
                  lang={name.lang}
                >
                  {marked && <PartyMark party={party} root={page.site.root} line />}
                  {name.text}
                </a>
              </h3>
              <p className={css({ marginTop: '8px' })}>
                <RatingBadge rating={cell.display} label={ratingLabel(locale, cell.display)} />
              </p>
              {cell.current && (
                <p className={css({ marginTop: '4px', fontSize: '16px', color: 'fg.muted' })}>
                  {t('election.updated', { date: new Date(cell.current.publishedAt) })}
                </p>
              )}
              {summary && (
                <p lang={summary.lang} className={css({ marginTop: '8px', fontSize: '17px' })}>
                  {summary.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </ElectionFrame>
  );
};

export default Criterion;
