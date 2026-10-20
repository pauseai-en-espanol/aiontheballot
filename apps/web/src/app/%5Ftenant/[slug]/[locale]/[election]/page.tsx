import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { InLanguage, Message } from '@/components/message';
import { PartyMark } from '@/components/party-identity';
import { RatingLegend } from '@/components/rating-legend';
import { RatingSummary } from '@/components/rating-summary';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { methodologyOf } from '@/election-view';
import { localText } from '@/local-text';
import { renderMarkdown } from '@/markdown';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { scorecardQuestion } from '@/scorecard-question';
import { focusRing, prose } from '@/styles';

export const generateMetadata = async (props: ElectionPageParams): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const { election } = page.election;
  return pageMetadata({
    ...page,
    share: electionPageShare(page, { view: 'overview' })?.preview,
    target: { page: 'election', election: election.slug },
    title: localText(election.name, page.locale, page.page.home.tenant.defaultLocale).text,
    description: scorecardQuestion(page),
  });
};

/** A way on from the summary: a solid button on the canvas, its arrow pointing on. */
const onward = cx(
  focusRing,
  css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    minHeight: '48px',
    paddingInline: '20px',
    bg: 'bg.inverse',
    color: 'fg.inverse',
    fontWeight: '700',
    fontSize: '17px',
    textDecoration: 'none',
    _hover: { textDecoration: 'underline', textUnderlineOffset: '3px' },
  }),
);

/**
 * An election's page (public-site spec §5.1; PLAN R218, after the chapter's first look at the demo): its name and
 * date, the editors' introduction when they wrote one, the question its ratings answer, and its summary, every party's
 * rating on every criterion as an icon, the legend right under it with the methodology. From there, the detailed
 * table, every rating in words, and each party's, criterion's and cell's page.
 */
const ElectionSummary = async (props: ElectionPageParams) => {
  const page = await loadElectionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const { election, parties, criteria } = page.election;
  // A mark's box beside every name once any party has a logo or a colour, so names stay in line; none otherwise (R184).
  const marked = parties.some((party) => Boolean(party.colour || party.logo));
  const { kind } = methodologyOf(page.election, page.page.home.tenant.methodologyKind);
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const name = text(election.name);
  const intro = election.intro ? text(election.intro) : undefined;
  const slug = election.slug;

  return (
    <ElectionFrame
      page={page}
      share={electionPageShare(page, { view: 'overview' })}
      target={{ page: 'election', election: slug }}
      title={<span lang={name.lang}>{name.text}</span>}
      subtitle={
        election.date && (
          <p className={css({ fontSize: '19px' })}>
            <time dateTime={election.date}>
              {t('election.date', { date: new Date(`${election.date}T12:00:00Z`) })}
            </time>
          </p>
        )
      }
    >
      {intro?.text && (
        <div
          lang={intro.lang}
          data-intro=""
          className={cx(prose, css({ marginBottom: '40px', fontSize: '19px' }))}
          // Sanitized: headings, lists, links and emphasis only; no raw HTML, no images (markdown.ts).
          dangerouslySetInnerHTML={{ __html: renderMarkdown(intro.text) }}
        />
      )}

      <section aria-labelledby="resumen">
        <h2
          id="resumen"
          className={css({
            fontSize: 'clamp(22px, 2.6vw, 28px)',
            fontWeight: '700',
            lineHeight: '1.25',
            maxWidth: '40ch',
          })}
        >
          {scorecardQuestion(page)}
        </h2>
        <p className={css({ fontSize: '16px', color: 'fg.muted', marginTop: '8px' })}>
          {page.updatedAt
            ? t('election.lastChange', { date: new Date(page.updatedAt) })
            : t('election.noRatingsYet')}
        </p>

        {parties.length === 0 || criteria.length === 0 ? (
          <p className={css({ fontSize: '18px', marginTop: '24px' })}>
            {parties.length === 0 ? t('election.noParties') : t('election.noCriteria')}
          </p>
        ) : (
          <div className={css({ marginTop: '24px' })}>
            <RatingSummary
              caption={
                <Message
                  format={(values) => t('election.tableCaption', values)}
                  parts={{ election: <InLanguage text={name} /> }}
                />
              }
              regionLabel={t('election.summary.region')}
              partyHeader={t('election.party')}
              parties={parties.map((party) => ({
                id: party.id,
                href: href({ page: 'party', election: slug, party: party.slug }),
                short: text(party.shortName),
                full: text(party.name),
                mark: marked ? <PartyMark party={party} root={page.site.root} line /> : undefined,
                // Why its row is pending, while its programme isn't out (ProgrammeStatus says it in full elsewhere).
                note:
                  party.programmeStatus === 'pending' && party.programmeCheckedAt
                    ? {
                        text: t('party.programmePendingShort'),
                        title: t('party.programmePending', {
                          checkedAt: new Date(party.programmeCheckedAt),
                        }),
                      }
                    : undefined,
              }))}
              criteria={criteria.map((criterion) => ({
                id: criterion.id,
                href: href({ page: 'criterion', election: slug, criterion: criterion.slug }),
                title: text(criterion.shortTitle ?? criterion.title),
              }))}
              cells={parties.map((party) =>
                criteria.map((criterion) => {
                  const { display } = page.cell(party, criterion);
                  const label = ratingLabel(locale, display);
                  return {
                    href: href({
                      page: 'cell',
                      election: slug,
                      party: party.slug,
                      criterion: criterion.slug,
                    }),
                    rating: display,
                    label,
                    title: t('election.summary.cellTitle', {
                      party: text(party.shortName).text,
                      criterion: text(criterion.shortTitle ?? criterion.title).text,
                      rating: label,
                    }),
                  };
                }),
              )}
            />
          </div>
        )}

        {/* Right under the table: the icons' words, and how they are given (BRIEF §3 invariant 2, §6). */}
        <RatingLegend
          locale={locale}
          kind={kind}
          methodologyHref={href({ page: 'methodology', election: slug })}
        />
      </section>

      {parties.length > 0 && criteria.length > 0 && (
        <p>
          <a href={href({ page: 'table', election: slug })} className={onward}>
            {t('election.summary.tableLink')}
            <span aria-hidden="true">→</span>
          </a>
        </p>
      )}
    </ElectionFrame>
  );
};

export default ElectionSummary;
