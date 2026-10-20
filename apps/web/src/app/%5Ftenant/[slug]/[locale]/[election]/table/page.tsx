import type { PublicCriterion, PublicParty } from '@aiontheballot/domain/public-election';
import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { InLanguage, Message } from '@/components/message';
import { PartyMark } from '@/components/party-identity';
import { ProgrammeStatus } from '@/components/programme-status';
import { RatingBadge } from '@/components/rating';
import { MethodologyLink } from '@/components/rating-legend';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { scorecardQuestion } from '@/scorecard-question';
import { focusRing } from '@/styles';

interface TableProps extends ElectionPageParams {
  searchParams: Promise<{ vista?: string | string[] }>;
}

export const generateMetadata = async (props: TableProps): Promise<Metadata> => {
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

/**
 * An election's detailed table (public-site spec §5.1; PLAN R218), which its summary links to: parties down the side
 * and criteria across the top on a desktop, a card per party (or per criterion) on a phone, every cell a link to its
 * page with its rating's icon and words.
 */
const DetailedTable = async (props: TableProps) => {
  const page = await loadElectionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const { election, parties, criteria } = page.election;
  // A mark's box beside every name once any party has a logo or a colour, so names stay in line; none otherwise (R184).
  const marked = parties.some((party) => Boolean(party.colour || party.logo));
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const name = text(election.name);
  const byCriterion = (await props.searchParams).vista === 'criterios';
  const scorecard = href({ page: 'table', election: election.slug });
  const cellHref = (party: PublicParty, criterion: PublicCriterion) =>
    href({ page: 'cell', election: election.slug, party: party.slug, criterion: criterion.slug });
  const badge = (party: PublicParty, criterion: PublicCriterion, stacked = false) => {
    const { display } = page.cell(party, criterion);
    return (
      <RatingBadge
        rating={display}
        label={ratingLabel(locale, display)}
        // In the table, the icon above its words, so a column takes a short label's width (R215).
        className={
          stacked
            ? css({ flexDirection: 'column', textAlign: 'center', gap: '4px', fontSize: '14px' })
            : undefined
        }
      />
    );
  };
  const header = (criterion: PublicCriterion) => text(criterion.shortTitle ?? criterion.title);
  const rated = page.updatedAt !== undefined;
  // The summary's images, under this page's own title (its share links say what they open).
  const share = electionPageShare(page, { view: 'overview' });

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
          {/* Desktop: the table, as wide as it needs past the text's column, centred on it and up to the window less
              its margins (R215); sideways scroll inside its own region only past that. */}
          <div
            role="region"
            aria-label={t('election.tableRegion')}
            // A region that scrolls must take the keyboard's focus, so it can be scrolled without a mouse (WCAG 2.1.1).
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className={cx(
              focusRing,
              css({
                display: { base: 'none', lg: 'block' },
                overflowX: 'auto',
                position: 'relative',
                width: 'max-content',
                minWidth: '100%',
                maxWidth: 'calc(100vw - 32px)',
                insetInlineStart: '50%',
                transform: 'translateX(-50%)',
              }),
            )}
          >
            <table
              className={css({ borderCollapse: 'collapse', minWidth: '100%', fontSize: '16px' })}
            >
              {/* For screen readers: the question above says it to everyone else. */}
              <caption className={css({ srOnly: true })}>
                <Message
                  format={(values) => t('election.tableCaption', values)}
                  parts={{ election: <InLanguage text={name} /> }}
                />
              </caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className={css({
                      position: 'sticky',
                      insetInlineStart: '0',
                      bg: 'bg.canvas',
                      textAlign: 'start',
                      padding: '12px',
                      borderBottom: '3px solid',
                      borderColor: 'border.default',
                    })}
                  >
                    {t('election.party')}
                  </th>
                  {criteria.map((criterion) => {
                    const title = header(criterion);
                    return (
                      <th
                        key={criterion.id}
                        scope="col"
                        className={css({
                          textAlign: 'center',
                          verticalAlign: 'bottom',
                          padding: '8px',
                          minWidth: '104px',
                          borderBottom: '3px solid',
                          borderColor: 'border.default',
                        })}
                      >
                        <a
                          href={href({
                            page: 'criterion',
                            election: election.slug,
                            criterion: criterion.slug,
                          })}
                          className={link}
                          lang={title.lang}
                        >
                          {title.text}
                        </a>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {parties.map((party) => {
                  const short = text(party.shortName);
                  const full = text(party.name);
                  return (
                    <tr
                      key={party.id}
                      className={css({ borderBottom: '1px solid', borderColor: 'border.subtle' })}
                    >
                      <th
                        scope="row"
                        className={css({
                          position: 'sticky',
                          insetInlineStart: '0',
                          bg: 'bg.canvas',
                          textAlign: 'start',
                          padding: '12px',
                          minWidth: '150px',
                        })}
                      >
                        <a
                          href={href({ page: 'party', election: election.slug, party: party.slug })}
                          className={cx(
                            link,
                            css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }),
                          )}
                        >
                          {marked && <PartyMark party={party} root={page.site.root} line />}
                          <abbr
                            title={full.text}
                            lang={short.lang}
                            className={css({ textDecoration: 'none' })}
                          >
                            {short.text}
                          </abbr>
                          {/* The full name for screen readers, which seldom read a title (spec §5.1). */}
                          {full.text !== short.text && (
                            <span lang={full.lang} className={css({ srOnly: true })}>
                              {`(${full.text})`}
                            </span>
                          )}
                        </a>
                        <ProgrammeStatus party={party} locale={locale} compact />
                      </th>
                      {criteria.map((criterion) => (
                        <td
                          key={criterion.id}
                          className={css({
                            padding: '8px',
                            verticalAlign: 'top',
                            textAlign: 'center',
                          })}
                        >
                          <a
                            href={cellHref(party, criterion)}
                            className={cx(
                              focusRing,
                              css({
                                display: 'inline-block',
                                _hover: { textDecoration: 'underline' },
                              }),
                            )}
                          >
                            {badge(party, criterion, true)}
                          </a>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: a card per party, or per criterion; plain links switch, so it works without scripts. */}
          <div className={css({ display: { base: 'block', lg: 'none' } })}>
            <nav aria-label={t('election.view')} className={css({ marginBottom: '16px' })}>
              <ul
                className={css({
                  display: 'flex',
                  gap: '16px',
                  listStyle: 'none',
                  fontSize: '17px',
                })}
              >
                {[
                  { label: t('election.byParty'), href: scorecard, current: !byCriterion },
                  {
                    label: t('election.byCriterion'),
                    href: `${scorecard}?vista=criterios`,
                    current: byCriterion,
                  },
                ].map(({ label, href: target, current }) => (
                  <li key={target}>
                    <a
                      href={target}
                      aria-current={current ? 'page' : undefined}
                      className={cx(link, current ? css({ fontWeight: '700' }) : undefined)}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <ul
              className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
                listStyle: 'none',
              })}
            >
              {(byCriterion ? criteria : parties).map((item) => {
                const isParty = 'shortName' in item;
                const title = isParty ? text(item.name) : text(item.title);
                const rows = isParty
                  ? criteria.map((criterion) => ({
                      key: criterion.id,
                      label: header(criterion),
                      party: item,
                      criterion,
                    }))
                  : parties.map((party) => ({
                      key: party.id,
                      label: text(party.shortName),
                      party,
                      criterion: item,
                    }));
                return (
                  <li
                    key={item.id}
                    className={css({
                      border: '2px solid',
                      borderColor: 'border.default',
                      padding: '16px',
                    })}
                  >
                    <h2
                      className={css({ fontSize: '21px', fontWeight: '700', marginBottom: '8px' })}
                    >
                      <a
                        href={
                          isParty
                            ? href({ page: 'party', election: election.slug, party: item.slug })
                            : href({
                                page: 'criterion',
                                election: election.slug,
                                criterion: item.slug,
                              })
                        }
                        className={cx(
                          link,
                          css({ display: 'inline-flex', alignItems: 'center', gap: '8px' }),
                        )}
                        lang={title.lang}
                      >
                        {isParty && marked && <PartyMark party={item} root={page.site.root} line />}
                        {title.text}
                      </a>
                    </h2>
                    {isParty && <ProgrammeStatus party={item} locale={locale} />}
                    <ul className={css({ listStyle: 'none', marginTop: '8px' })}>
                      {rows.map((row) => (
                        <li
                          key={row.key}
                          className={css({ borderTop: '1px solid', borderColor: 'border.subtle' })}
                        >
                          <a
                            href={cellHref(row.party, row.criterion)}
                            className={cx(
                              focusRing,
                              css({
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '12px',
                                paddingBlock: '10px',
                                minHeight: '44px',
                              }),
                            )}
                          >
                            <span lang={row.label.lang} className={css({ fontWeight: '600' })}>
                              {row.label.text}
                            </span>
                            {badge(row.party, row.criterion)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </ElectionFrame>
  );
};

export default DetailedTable;
