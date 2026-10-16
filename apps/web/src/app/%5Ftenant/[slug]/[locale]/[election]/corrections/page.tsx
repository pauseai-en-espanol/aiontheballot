import type { Metadata } from 'next';

import { isLocalized } from '@aiontheballot/domain/localized';
import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';

import { ElectionFrame } from '@/components/election-frame';
import { RatingBadge } from '@/components/rating';
import { type CorrectionEntry, correctionsLog, FIELD_ORDER, fieldChanges } from '@/corrections-log';
import { electionPageShare } from '@/election-images';
import { type ElectionPageParams, loadElectionPage } from '@/election-page';
import { localText } from '@/local-text';
import { pageMetadata } from '@/page-metadata';
import { ratingLabel } from '@/rating-label';
import { focusRing } from '@/styles';

export const generateMetadata = async (props: ElectionPageParams): Promise<Metadata> => {
  const page = await loadElectionPage(props);
  const t = getTranslator(page.locale);
  return pageMetadata({
    ...page,
    share: electionPageShare(page, { view: 'corrections' })?.preview,
    target: { page: 'corrections', election: page.election.election.slug },
    title: t('correctionsPage.title'),
    description: t('correctionsPage.lead'),
  });
};

/** The columns a change request may change (CR1.2), which the log names in words. */
const isFieldWord = (field: string): field is (typeof FIELD_ORDER)[number] =>
  (FIELD_ORDER as readonly string[]).includes(field);

const link = cx(focusRing, css({ textDecoration: 'underline', textUnderlineOffset: '3px' }));

/** A value as a structural change recorded it, in words: localized text in the page's language, a date, a list. */
const valueText = (value: unknown, locale: Locale, defaultLocale: string): string => {
  const t = getTranslator(locale);
  if (value === null || value === undefined || value === '') {
    return t('correctionsPage.none');
  }
  if (isLocalized(value)) {
    return localText(value, locale, defaultLocale).text;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(', ') : t('correctionsPage.none');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, {
      dateStyle: 'long',
      timeZone: 'UTC',
    });
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : t('correctionsPage.none');
};

/**
 * The election's public corrections log (BRIEF §4; editorial workflow H1.4; PLAN R150): every later revision of a
 * cell and every approved change to the structure, newest first, each with its date and public note, linking to the
 * cell it changed. What the site promises on its home ("Correcciones públicas") is kept here.
 */
const Corrections = async (props: ElectionPageParams) => {
  const page = await loadElectionPage(props);
  const { locale, href } = page;
  const t = getTranslator(locale);
  const defaultLocale = page.page.home.tenant.defaultLocale;
  const text = (value: Parameters<typeof localText>[0]) => localText(value, locale, defaultLocale);
  const election = page.election.election.slug;
  const entries = correctionsLog(page.election);
  const when = (instant: string) => new Date(instant);
  const item = (entry: CorrectionEntry) => {
    if (entry.kind === 'revision') {
      const party = text(entry.party.shortName);
      const criterion = text(entry.criterion.title);
      const note = entry.note ? text(entry.note) : undefined;
      return (
        <>
          <p className={css({ fontWeight: '700' })}>
            {t(`cellPage.change.${entry.change}`)} ·{' '}
            <a
              href={href({
                page: 'cell',
                election,
                party: entry.party.slug,
                criterion: entry.criterion.slug,
              })}
              className={link}
            >
              <span lang={party.lang}>{party.text}</span> ·{' '}
              <span lang={criterion.lang}>{criterion.text}</span>
            </a>
          </p>
          {entry.rating && (
            <p>
              <RatingBadge
                rating={entry.rating}
                label={t('correctionsPage.rated', { rating: ratingLabel(locale, entry.rating) })}
              />
            </p>
          )}
          {note && <p lang={note.lang}>{t('cellPage.note', { note: note.text })}</p>}
        </>
      );
    }
    const { change } = entry;
    const target =
      change.target === null
        ? t(`correctionsPage.targets.${change.targetKind}`)
        : `${t(`correctionsPage.targets.${change.targetKind}`)} ${
            typeof change.target === 'string' ? change.target : text(change.target).text
          }`;
    // Its one field, or each of a set's (PLAN R183), by name; the values of the short ones.
    const changed = fieldChanges(change);
    const word = (name: string) =>
      isFieldWord(name) ? t(`correctionsPage.fields.${name}`) : t('correctionsPage.fields.other');
    const field = new Intl.ListFormat(locale, { type: 'conjunction' }).format(
      changed.map((one) => word(one.field)),
    );
    const shown = changed.filter((one) => one.shown);
    const note = text(change.publicNote);
    const value = (of: unknown) => valueText(of, locale, defaultLocale);
    return (
      <>
        <p className={css({ fontWeight: '700' })}>
          {t(`correctionsPage.actions.${change.action}`, { target, field })}
        </p>
        {changed.length === 1 && shown[0] ? (
          <ul className={css({ listStyle: 'none' })}>
            <li>{t('correctionsPage.before', { value: value(shown[0].before) })}</li>
            <li>{t('correctionsPage.after', { value: value(shown[0].after) })}</li>
          </ul>
        ) : shown.length > 0 ? (
          <ul className={css({ listStyle: 'none' })}>
            {shown.map((one) => {
              const name = word(one.field);
              return (
                <li key={one.field}>
                  {t('correctionsPage.fieldChange', {
                    field: `${name.charAt(0).toLocaleUpperCase(locale)}${name.slice(1)}`,
                    before: value(one.before),
                    after: value(one.after),
                  })}
                </li>
              );
            })}
          </ul>
        ) : null}
        <p lang={note.lang}>{t('cellPage.note', { note: note.text })}</p>
      </>
    );
  };
  return (
    <ElectionFrame
      page={page}
      share={electionPageShare(page, { view: 'corrections' })}
      target={{ page: 'corrections', election }}
      title={t('correctionsPage.title')}
    >
      <p className={css({ fontSize: '19px', lineHeight: '1.55', maxWidth: '65ch' })}>
        {t('correctionsPage.lead')}
      </p>
      {entries.length === 0 ? (
        <p className={css({ marginTop: '24px', fontSize: '18px' })}>{t('correctionsPage.empty')}</p>
      ) : (
        <ol className={css({ listStyle: 'none', marginTop: '24px', display: 'grid', gap: '20px' })}>
          {entries.map((entry) => (
            <li
              key={`${entry.kind}-${entry.at}-${entry.kind === 'revision' ? `${entry.party.id}-${entry.criterion.id}` : entry.change.targetKind}`}
              className={css({
                display: 'grid',
                gap: '6px',
                paddingBlock: '16px',
                borderTop: '1px solid',
                borderColor: 'border.subtle',
                fontSize: '17px',
              })}
            >
              <p className={css({ fontSize: '15px', color: 'fg.muted' })}>
                <time dateTime={entry.at}>{t('election.updated', { date: when(entry.at) })}</time>
              </p>
              {item(entry)}
            </li>
          ))}
        </ol>
      )}
    </ElectionFrame>
  );
};

export default Corrections;
