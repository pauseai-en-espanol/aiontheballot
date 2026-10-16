import type { PublicSource } from '@aiontheballot/domain/public-election';
import type { Locale } from '@aiontheballot/i18n/messages';
import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';
import { notFound } from 'next/navigation';

import { ElectionFrame } from '@/components/election-frame';
import { InLanguage, Message } from '@/components/message';
import { ProgrammeStatus } from '@/components/programme-status';
import { RatingBadge } from '@/components/rating';
import { RatingLegend } from '@/components/rating-legend';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { methodologyOf } from '@/election-view';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing } from '@/styles';

interface CellProps extends ElectionPageParams {
  params: Promise<{
    slug: string;
    locale: string;
    election: string;
    party: string;
    criterion: string;
  }>;
}

const cellPage = async (props: CellProps) => {
  const page = await loadElectionPage(props);
  const { party: partySlug, criterion: criterionSlug } = await props.params;
  const party = page.election.parties.find((p) => p.slug === partySlug);
  const criterion = page.election.criteria.find((c) => c.slug === criterionSlug);
  if (!party || !criterion) {
    notFound();
  }
  return { page, cell: page.cell(party, criterion) };
};

export const generateMetadata = async (props: CellProps): Promise<Metadata> => {
  const { page, cell } = await cellPage(props);
  const t = getTranslator(page.locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const party = localText(cell.party.shortName, page.locale, defaultLocale).text;
  const criterion = localText(cell.criterion.title, page.locale, defaultLocale).text;
  return pageMetadata({
    ...page,
    share: electionPageShare(page, {
      view: 'cell',
      party: cell.party.slug,
      criterion: cell.criterion.slug,
    })?.preview,
    target: {
      page: 'cell',
      election: page.election.election.slug,
      party: cell.party.slug,
      criterion: cell.criterion.slug,
    },
    title: t('cellPage.title', { party, criterion }),
    description: `${party}, ${criterion}: ${ratingLabel(page.locale, cell.display)}`,
  });
};

const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/** A source's language, for its title and quotes: the one recorded, else the site's. */
const sourceLang = (source: PublicSource, defaultLocale: string): string =>
  source.language ?? defaultLocale;

/** Where a quote or a checked document comes from: its public columns only (data model §5; PLAN P8). */
const Source = ({
  source,
  locale,
  defaultLocale,
}: {
  source: PublicSource;
  locale: Locale;
  defaultLocale: string;
}) => {
  const t = getTranslator(locale);
  const lang = sourceLang(source, defaultLocale);
  return (
    <ul
      className={css({ listStyle: 'none', fontSize: '15px', color: 'fg.muted', marginTop: '6px' })}
    >
      <li>
        {t('cellPage.source')}:{' '}
        {source.url ? (
          <a href={source.url} className={link} lang={lang}>
            {source.title}
          </a>
        ) : (
          <span lang={lang}>{source.title}</span>
        )}
      </li>
      {source.retrievedAt && (
        <li>{t('cellPage.retrieved', { date: new Date(source.retrievedAt) })}</li>
      )}
      {source.archiveUrl && (
        <li>
          <a href={source.archiveUrl} className={link}>
            {t('cellPage.archived')}
          </a>
        </li>
      )}
      {source.sha256 && (
        <li className={css({ overflowWrap: 'anywhere', fontFamily: 'mono', fontSize: '13px' })}>
          {t('cellPage.hash', { hash: source.sha256 })}
        </li>
      )}
    </ul>
  );
};

/**
 * A cell's page (public-site spec §5.2): the rating or the pending state, the summary, each quote with its source,
 * the documents checked for "No lo menciona", and every published revision.
 */
const Cell = async (props: CellProps) => {
  const { page, cell } = await cellPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const { election } = page.election;
  const { kind } = methodologyOf(page.election, page.page.home.tenant.methodologyKind);
  const party = text(cell.party.shortName);
  const criterion = text(cell.criterion.title);
  const { current } = cell;
  const summary = current?.summary ? text(current.summary) : undefined;
  return (
    <ElectionFrame
      page={page}
      share={electionPageShare(page, {
        view: 'cell',
        party: cell.party.slug,
        criterion: cell.criterion.slug,
      })}
      target={{
        page: 'cell',
        election: election.slug,
        party: cell.party.slug,
        criterion: cell.criterion.slug,
      }}
      title={
        <Message
          format={(values) => t('cellPage.title', values)}
          parts={{
            party: <InLanguage text={party} />,
            criterion: <InLanguage text={criterion} />,
          }}
        />
      }
      trail={[
        {
          href: href({ page: 'party', election: election.slug, party: cell.party.slug }),
          label: <span lang={party.lang}>{party.text}</span>,
        },
      ]}
    >
      <p className={css({ fontSize: '22px', fontWeight: '700' })}>
        <RatingBadge rating={cell.display} label={ratingLabel(locale, cell.display)} />
      </p>
      {current && (
        <p className={css({ fontSize: '16px', color: 'fg.muted', marginTop: '8px' })}>
          {t('election.updated', { date: new Date(current.publishedAt) })}
        </p>
      )}
      {cell.display === 'pending' && (
        <>
          <p className={css({ fontSize: '18px', marginTop: '12px', maxWidth: '65ch' })}>
            {t('cellPage.pendingLead')}
          </p>
          <ProgrammeStatus party={cell.party} locale={locale} />
        </>
      )}
      {cell.display === 'withdrawn' && (
        <p className={css({ fontSize: '18px', marginTop: '12px' })}>
          {t('cellPage.withdrawnLead')}
        </p>
      )}
      <RatingLegend
        locale={locale}
        kind={kind}
        methodologyHref={href({ page: 'methodology', election: election.slug })}
      />
      {summary && (
        <section
          aria-labelledby="por-que"
          className={css({ marginBottom: '32px', maxWidth: '70ch' })}
        >
          <h2
            id="por-que"
            className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('cellPage.summary')}
          </h2>
          <p lang={summary.lang} className={css({ fontSize: '18px', whiteSpace: 'pre-line' })}>
            {summary.text}
          </p>
        </section>
      )}
      {current && current.evidence.length > 0 && (
        <section
          aria-labelledby="fuentes"
          className={css({ marginBottom: '32px', maxWidth: '70ch' })}
        >
          <h2
            id="fuentes"
            className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('cellPage.evidence')}
          </h2>
          <ol
            className={css({
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            })}
          >
            {current.evidence.map((item, index) => (
              <li key={index}>
                <blockquote
                  lang={sourceLang(item.source, defaultLocale)}
                  className={css({
                    borderInlineStart: '4px solid',
                    borderColor: 'border.default',
                    paddingInlineStart: '16px',
                    fontSize: '18px',
                    whiteSpace: 'pre-line',
                  })}
                >
                  {item.quote}
                </blockquote>
                {item.locationLabel && (
                  <p className={css({ fontSize: '15px', marginTop: '6px' })}>
                    {/* Written by the editors, in the site's language. */}
                    <Message
                      format={(values) => t('cellPage.location', values)}
                      parts={{
                        location: (
                          <InLanguage text={{ text: item.locationLabel, lang: defaultLocale }} />
                        ),
                      }}
                    />
                  </p>
                )}
                <Source source={item.source} locale={locale} defaultLocale={defaultLocale} />
              </li>
            ))}
          </ol>
        </section>
      )}
      {current && current.checkedDocuments.length > 0 && (
        <section
          aria-labelledby="revisados"
          className={css({ marginBottom: '32px', maxWidth: '70ch' })}
        >
          <h2
            id="revisados"
            className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('cellPage.checked')}
          </h2>
          <ul
            className={css({
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            })}
          >
            {current.checkedDocuments.map((item) => (
              <li key={`${item.source.title}-${item.checkedAt}`}>
                <p className={css({ fontSize: '16px' })}>
                  {t('cellPage.checkedOn', { date: new Date(item.checkedAt) })}
                </p>
                <Source source={item.source} locale={locale} defaultLocale={defaultLocale} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {cell.history.length > 0 && (
        <section aria-labelledby="historial" className={css({ maxWidth: '70ch' })}>
          <h2
            id="historial"
            className={css({ fontSize: '24px', fontWeight: '700', marginBottom: '8px' })}
          >
            {t('cellPage.history')}
          </h2>
          <ol
            className={css({
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            })}
          >
            {cell.history.map((revision) => {
              const note = revision.publicNote ? text(revision.publicNote) : undefined;
              const shown = revision.rating ?? 'withdrawn';
              return (
                <li
                  key={revision.revisionNo}
                  className={css({
                    borderTop: '1px solid',
                    borderColor: 'border.subtle',
                    paddingTop: '10px',
                  })}
                >
                  <p className={css({ fontSize: '16px', fontWeight: '700' })}>
                    {t('cellPage.revision', {
                      number: revision.revisionNo,
                      date: new Date(revision.publishedAt),
                    })}
                    {' · '}
                    {t(`cellPage.change.${revision.changeKind}`)}
                  </p>
                  <p className={css({ marginTop: '4px' })}>
                    <RatingBadge rating={shown} label={ratingLabel(locale, shown)} />
                  </p>
                  {note && (
                    <p lang={note.lang} className={css({ fontSize: '16px', marginTop: '4px' })}>
                      {t('cellPage.note', { note: note.text })}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </ElectionFrame>
  );
};

export default Cell;
