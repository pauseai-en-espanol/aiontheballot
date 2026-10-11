import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';
import { notFound } from 'next/navigation';

import { ElectionFrame } from '@/components/election-frame';
import { PartySwatch } from '@/components/party-swatch';
import { ProgrammeStatus } from '@/components/programme-status';
import { RatingBadge } from '@/components/rating';
import { RatingLegend } from '@/components/rating-legend';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing } from '@/styles';

interface PartyProps extends ElectionPageParams {
  params: Promise<{ slug: string; locale: string; election: string; party: string }>;
}

const partyPage = async (props: PartyProps) => {
  const page = await loadElectionPage(props);
  const { party: slug } = await props.params;
  const party = page.election.parties.find((p) => p.slug === slug);
  if (!party) {
    notFound();
  }
  return { page, party };
};

export const generateMetadata = async (props: PartyProps): Promise<Metadata> => {
  const { page, party } = await partyPage(props);
  const t = getTranslator(page.locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const name = localText(party.name, page.locale, defaultLocale).text;
  return pageMetadata({
    ...page,
    target: { page: 'party', election: page.election.election.slug, party: party.slug },
    title: name,
    description: `${name}: ${t('partyPage.ratings')}`,
  });
};

/** A party's page (public-site spec §5.2): its programme status, and its rating on every criterion. */
const Party = async (props: PartyProps) => {
  const { page, party } = await partyPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const { election, criteria, methodology } = page.election;
  const name = text(party.name);
  return (
    <ElectionFrame
      page={page}
      target={{ page: 'party', election: election.slug, party: party.slug }}
      title={
        <span
          lang={name.lang}
          className={css({ display: 'inline-flex', alignItems: 'center', gap: '12px' })}
        >
          <PartySwatch colour={party.colour} />
          {name.text}
        </span>
      }
    >
      <ProgrammeStatus party={party} locale={locale} />
      {party.website && (
        <p className={css({ fontSize: '18px', marginTop: '8px' })}>
          {t('partyPage.website')}:{' '}
          <a href={party.website} className={cx(focusRing, css({ textDecoration: 'underline' }))}>
            {party.website}
          </a>
        </p>
      )}
      <RatingLegend
        locale={locale}
        kind={methodology?.kind ?? page.page.home.tenant.methodologyKind}
        methodologyHref={href({ page: 'methodology', election: election.slug })}
      />
      <h2 className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '12px' })}>
        {t('partyPage.ratings')}
      </h2>
      <ul className={css({ listStyle: 'none', maxWidth: '72ch' })}>
        {criteria.map((criterion) => {
          const cell = page.cell(party, criterion);
          const title = text(criterion.title);
          const summary = cell.current?.summary ? text(cell.current.summary) : undefined;
          return (
            <li
              key={criterion.id}
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
                    css({ textDecoration: 'underline', textUnderlineOffset: '3px' }),
                  )}
                  lang={title.lang}
                >
                  {title.text}
                </a>
              </h3>
              <p className={css({ marginTop: '8px' })}>
                <RatingBadge rating={cell.display} label={ratingLabel(locale, cell.display)} />
              </p>
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

export default Party;
