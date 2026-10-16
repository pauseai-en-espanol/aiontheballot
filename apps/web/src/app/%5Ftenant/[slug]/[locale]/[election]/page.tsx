import type { PublicCriterion, PublicParty } from '@aiontheballot/domain/public-election';
import type { Metadata } from 'next';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { InLanguage, Message } from '@/components/message';
import { PartyMark } from '@/components/party-identity';
import { ProgrammeStatus } from '@/components/programme-status';
import { RatingBadge } from '@/components/rating';
import { RatingLegend } from '@/components/rating-legend';
import { electionPageShare } from '@/election-images';
import {
  type ElectionPageParams,
  type LoadedElectionPage,
  loadElectionPage,
} from '@/election-page';
import { methodologyOf } from '@/election-view';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing } from '@/styles';

interface ScorecardProps extends ElectionPageParams {
  searchParams: Promise<{ vista?: string | string[] }>;
}

/** The scorecard's question, in the words of its methodology's kind, as the legend's scale. */
const question = (page: LoadedElectionPage): string => {
  const t = getTranslator(page.locale);
  const { home } = page.page;
  const { kind, owner } = methodologyOf(page.election, home.tenant.methodologyKind);
  if (kind === 'descriptive') {
    return t('election.question.descriptive');
  }
  return owner
    ? t('election.question.demands', {
        owner: pickLocalized(owner.name, page.locale, home.tenant.defaultLocale) ?? '',
      })
    : t('election.question.demandsUnnamed');
};

export const generateMetadata = async (props: ScorecardProps): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const { election } = page.election;
  return pageMetadata({
    ...page,
    share: electionPageShare(page, { view: 'overview' })?.preview,
    target: { page: 'election', election: election.slug },
    title: localText(election.name, page.locale, page.page.home.tenant.defaultLocale).text,
    description: question(page),
  });
};

const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/**
 * An election's scorecard (public-site spec §5.1): parties down the side and criteria across the top on a desktop, a
 * card per party (or per criterion) on a phone, every cell a link to its page with its rating's icon and words.
 */
const Scorecard = async (props: ScorecardProps) => {
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
  const byCriterion = (await props.searchParams).vista === 'criterios';
  const scorecard = href({ page: 'election', election: election.slug });
  const cellHref = (party: PublicParty, criterion: PublicCriterion) =>
    href({ page: 'cell', election: election.slug, party: party.slug, criterion: criterion.slug });
  const badge = (party: PublicParty, criterion: PublicCriterion) => {
    const { display } = page.cell(party, criterion);
    return <RatingBadge rating={display} label={ratingLabel(locale, display)} />;
  };
  const header = (criterion: PublicCriterion) => text(criterion.shortTitle ?? criterion.title);
  const rated = page.updatedAt !== undefined;

  return (
    <ElectionFrame
      page={page}
      share={electionPageShare(page, { view: 'overview' })}
      target={{ page: 'election', election: election.slug }}
      title={<span lang={name.lang}>{name.text}</span>}
      subtitle={
        election.date && (
          <p className={css({ fontSize: '19px', marginTop: '-16px', marginBottom: '24px' })}>
            <time dateTime={election.date}>
              {t('election.date', { date: new Date(`${election.date}T12:00:00Z`) })}
            </time>
          </p>
        )
      }
    >
      <p className={css({ fontSize: '21px', fontWeight: '700', maxWidth: '60ch' })}>
        {question(page)}
      </p>
      <RatingLegend
        locale={locale}
        kind={kind}
        methodologyHref={href({ page: 'methodology', election: election.slug })}
      />
      <p className={css({ fontSize: '16px', color: 'fg.muted', marginBottom: '24px' })}>
        {rated && page.updatedAt
          ? t('election.lastChange', { date: new Date(page.updatedAt) })
          : t('election.noRatingsYet')}
      </p>

      {parties.length === 0 || criteria.length === 0 ? (
        <p className={css({ fontSize: '18px' })}>
          {parties.length === 0 ? t('election.noParties') : t('election.noCriteria')}
        </p>
      ) : (
        <>
          {/* Desktop: the table, sideways scroll inside its own region past about eight criteria. */}
          <div
            role="region"
            aria-label={t('election.tableRegion')}
            // A region that scrolls must take the keyboard's focus, so it can be scrolled without a mouse (WCAG 2.1.1).
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className={cx(
              focusRing,
              css({ display: { base: 'none', lg: 'block' }, overflowX: 'auto', maxWidth: '100%' }),
            )}
          >
            <table
              className={css({ borderCollapse: 'collapse', minWidth: '100%', fontSize: '16px' })}
            >
              <caption
                className={css({
                  textAlign: 'start',
                  fontWeight: '700',
                  paddingBottom: '12px',
                  fontSize: '17px',
                })}
              >
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
                          textAlign: 'start',
                          verticalAlign: 'bottom',
                          padding: '12px',
                          minWidth: '150px',
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
                          minWidth: '180px',
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
                          className={css({ padding: '12px', verticalAlign: 'top' })}
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
                            {badge(party, criterion)}
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

export default Scorecard;
