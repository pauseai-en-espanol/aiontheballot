import type { PublicCriterion, PublicParty } from '@aiontheballot/domain/public-election';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { InLanguage, Message } from '@/components/message';
import { PartyMark } from '@/components/party-identity';
import { RatingBadge } from '@/components/rating';
import { MethodologyLink } from '@/components/rating-legend';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { scorecardQuestion } from '@/scorecard-question';
import { focusRing } from '@/styles';

export const generateMetadata = async (props: ElectionPageParams): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const t = getTranslator(page.locale);
  const { election } = page.election;
  const name = localText(election.name, page.locale, page.page.home.tenant.defaultLocale).text;
  return pageMetadata({
    ...page,
    share: electionPageShare(page, { view: 'overview' })?.preview,
    target: { page: 'table', election: election.slug },
    title: `${t('election.table.title')} · ${name}`,
    description: scorecardQuestion(page),
  });
};

const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/** The index's id, which every section's way back points at. */
const INDEX = 'indice';

/** A criterion's section's id, the address of its anchor (`/tabla#criterio-aesia`). */
const sectionId = (criterion: PublicCriterion) => `criterio-${criterion.slug}`;

/**
 * A row's party: its mark and its short name, its full name as the abbreviation's title and, unless `spoken` is off,
 * for screen readers, which seldom read a title (spec §5.1). Off in a link whose name must start with its visible
 * words, the rating after them (WCAG 2.5.3).
 */
const PartyName = ({
  short,
  full,
  mark,
  spoken = true,
}: {
  short: { text: string; lang: string };
  full: { text: string; lang: string };
  mark: ReactNode;
  spoken?: boolean;
}) => (
  <>
    {mark}
    <abbr title={full.text} lang={short.lang} className={css({ textDecoration: 'none' })}>
      {short.text}
    </abbr>
    {spoken && full.text !== short.text && (
      <span lang={full.lang} className={css({ srOnly: true })}>
        {`(${full.text})`}
      </span>
    )}
  </>
);

/**
 * An election's detailed table (public-site spec §5.1; PLAN R218, R225), which its summary links to: after a chapter
 * member's look at it ("a bit overwhelming … no more than 4 columns together … sections, with an index on top"), a
 * section per criterion, in the criteria's order, each a small table of every party's rating on it in words with why,
 * under an index that jumps to any of them. Every rating links to its cell's page, with its quotes and sources. A
 * party's ratings across the criteria are its own page's.
 */
const DetailedTable = async (props: ElectionPageParams) => {
  const page = await loadElectionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const { election, parties, criteria } = page.election;
  // A mark's box beside every name once any party has a logo or a colour, so names stay in line; none otherwise (R184).
  const marked = parties.some((party) => Boolean(party.colour || party.logo));
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const cellHref = (party: PublicParty, criterion: PublicCriterion) =>
    href({ page: 'cell', election: election.slug, party: party.slug, criterion: criterion.slug });
  const rated = page.updatedAt !== undefined;
  // The summary's images, under this page's own title (its share links say what they open).
  const share = electionPageShare(page, { view: 'overview' });

  /** A party's row on a criterion: its rating, and why, or, while its programme isn't out, that it isn't. */
  const row = (party: PublicParty, criterion: PublicCriterion) => {
    const cell = page.cell(party, criterion);
    const summary = cell.current?.summary ? text(cell.current.summary) : undefined;
    const why = summary ? (
      <span lang={summary.lang}>{summary.text}</span>
    ) : party.programmeStatus === 'pending' && party.programmeCheckedAt ? (
      <span className={css({ color: 'fg.muted' })}>
        {t('party.programmePending', { checkedAt: new Date(party.programmeCheckedAt) })}
      </span>
    ) : undefined;
    return {
      party,
      short: text(party.shortName),
      full: text(party.name),
      mark: marked ? <PartyMark party={party} root={page.site.root} line /> : undefined,
      href: cellHref(party, criterion),
      badge: <RatingBadge rating={cell.display} label={ratingLabel(locale, cell.display)} />,
      why,
    };
  };

  return (
    <ElectionFrame
      page={page}
      share={share && { ...share, text: `${t('election.table.title')} · ${share.text}` }}
      target={{ page: 'table', election: election.slug }}
      title={t('election.table.title')}
      subtitle={
        <p className={css({ fontSize: '19px', maxWidth: '60ch' })}>{scorecardQuestion(page)}</p>
      }
    >
      {/* Every rating below shows its words beside its icon: no legend to repeat them, the methodology's link (R218). */}
      <p
        className={css({
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px 24px',
          fontSize: '16px',
          marginBottom: '24px',
        })}
      >
        <span className={css({ color: 'fg.muted' })}>
          {rated && page.updatedAt
            ? t('election.lastChange', { date: new Date(page.updatedAt) })
            : t('election.noRatingsYet')}
        </span>
        <MethodologyLink
          locale={locale}
          href={href({ page: 'methodology', election: election.slug })}
        />
      </p>

      {parties.length === 0 || criteria.length === 0 ? (
        <p className={css({ fontSize: '18px' })}>
          {parties.length === 0 ? t('election.noParties') : t('election.noCriteria')}
        </p>
      ) : (
        <>
          {/* The index: straight to the criterion that matters to whoever reads, each section a way back. */}
          <nav
            aria-labelledby={INDEX}
            className={css({
              borderBlock: '2px solid',
              borderColor: 'border.default',
              paddingBlock: '16px',
              marginBottom: '40px',
            })}
          >
            <h2
              id={INDEX}
              className={css({ fontSize: '19px', fontWeight: '700', scrollMarginTop: '16px' })}
            >
              {t('election.table.index')}
            </h2>
            <ol
              className={css({
                listStyle: 'none',
                marginTop: '8px',
                columns: { base: '1', sm: '2', lg: '3' },
                columnGap: '32px',
                fontSize: '17px',
              })}
            >
              {criteria.map((criterion) => {
                const title = text(criterion.shortTitle ?? criterion.title);
                return (
                  <li key={criterion.id} className={css({ breakInside: 'avoid' })}>
                    <a
                      href={`#${sectionId(criterion)}`}
                      lang={title.lang}
                      className={cx(link, css({ display: 'inline-block', paddingBlock: '4px' }))}
                    >
                      {title.text}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>

          {criteria.map((criterion) => {
            const id = sectionId(criterion);
            const short = text(criterion.shortTitle ?? criterion.title);
            const title = text(criterion.title);
            const rows = parties.map((party) => row(party, criterion));
            return (
              <section
                key={criterion.id}
                aria-labelledby={id}
                className={css({ marginBottom: '48px' })}
              >
                <h2
                  id={id}
                  className={css({
                    fontSize: 'clamp(22px, 2.6vw, 28px)',
                    fontWeight: '700',
                    lineHeight: '1.25',
                    scrollMarginTop: '16px',
                  })}
                >
                  <a
                    href={href({
                      page: 'criterion',
                      election: election.slug,
                      criterion: criterion.slug,
                    })}
                    lang={short.lang}
                    className={link}
                  >
                    {short.text}
                  </a>
                </h2>
                {title.text !== short.text && (
                  <p
                    lang={title.lang}
                    className={css({ fontSize: '17px', color: 'fg.muted', marginTop: '4px' })}
                  >
                    {title.text}
                  </p>
                )}

                {/* From a tablet up: a table of three columns, party, rating and why. */}
                <table
                  className={css({
                    display: { base: 'none', md: 'table' },
                    width: '100%',
                    // The same column widths in every section, so they line up down the page.
                    tableLayout: 'fixed',
                    borderCollapse: 'collapse',
                    marginTop: '16px',
                    fontSize: '16px',
                  })}
                >
                  {/* For screen readers: the heading above says it to everyone else. */}
                  <caption className={css({ srOnly: true })}>
                    <Message
                      format={(values) => t('election.table.sectionCaption', values)}
                      parts={{ criterion: <InLanguage text={short} /> }}
                    />
                  </caption>
                  <thead>
                    <tr>
                      {[
                        { label: t('election.party'), width: css({ width: '10rem' }) },
                        // Room for the longest rating's words beside its icon ("Pendiente de evaluar").
                        { label: t('election.table.rating'), width: css({ width: '14rem' }) },
                        { label: t('election.table.why'), width: undefined },
                      ].map(({ label, width }) => (
                        <th
                          key={label}
                          scope="col"
                          className={cx(
                            width,
                            css({
                              textAlign: 'start',
                              paddingBlock: '8px',
                              paddingInlineEnd: '16px',
                              borderBottom: '3px solid',
                              borderColor: 'border.default',
                              fontSize: '15px',
                            }),
                          )}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr
                        key={item.party.id}
                        className={css({ borderBottom: '1px solid', borderColor: 'border.subtle' })}
                      >
                        <th
                          scope="row"
                          className={css({
                            textAlign: 'start',
                            verticalAlign: 'top',
                            paddingBlock: '12px',
                            paddingInlineEnd: '16px',
                            whiteSpace: 'nowrap',
                          })}
                        >
                          <a
                            href={href({
                              page: 'party',
                              election: election.slug,
                              party: item.party.slug,
                            })}
                            className={cx(
                              link,
                              css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }),
                            )}
                          >
                            <PartyName short={item.short} full={item.full} mark={item.mark} />
                          </a>
                        </th>
                        <td
                          className={css({
                            verticalAlign: 'top',
                            paddingBlock: '12px',
                            paddingInlineEnd: '16px',
                            whiteSpace: 'nowrap',
                          })}
                        >
                          <a
                            href={item.href}
                            className={cx(
                              focusRing,
                              css({
                                display: 'inline-block',
                                paddingBlock: '2px',
                                _hover: { textDecoration: 'underline' },
                              }),
                            )}
                          >
                            {item.badge}
                          </a>
                        </td>
                        <td
                          className={css({
                            verticalAlign: 'top',
                            paddingBlock: '12px',
                            fontSize: '16px',
                            lineHeight: '1.5',
                            maxWidth: '60ch',
                          })}
                        >
                          {item.why}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* On a phone: the same, a party a row, its rating beside its name and why under them. */}
                <ul
                  className={css({
                    display: { base: 'block', md: 'none' },
                    listStyle: 'none',
                    marginTop: '12px',
                  })}
                >
                  {rows.map((item) => (
                    <li
                      key={item.party.id}
                      className={css({
                        borderTop: '1px solid',
                        borderColor: 'border.subtle',
                        paddingBlock: '10px',
                      })}
                    >
                      <a
                        href={item.href}
                        className={cx(
                          focusRing,
                          css({
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '4px 12px',
                            minHeight: '44px',
                          }),
                        )}
                      >
                        <span
                          className={css({
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontWeight: '700',
                          })}
                        >
                          <PartyName
                            short={item.short}
                            full={item.full}
                            mark={item.mark}
                            spoken={false}
                          />
                        </span>
                        {item.badge}
                      </a>
                      {item.why && (
                        <p
                          className={css({ fontSize: '16px', lineHeight: '1.5', marginTop: '4px' })}
                        >
                          {item.why}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                <p className={css({ marginTop: '12px', fontSize: '16px' })}>
                  <a href={`#${INDEX}`} className={link}>
                    <span aria-hidden="true">↑ </span>
                    {t('election.table.backToIndex')}
                  </a>
                </p>
              </section>
            );
          })}
        </>
      )}
    </ElectionFrame>
  );
};

export default DetailedTable;
