import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';

import { inLanguage } from '@/localized';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

import type { Recheck } from './data';

/**
 * The published "not mentioned" ratings to check again (D20, PLAN R187): each was checked only against documents since
 * marked replaced (a party's new programme), so it says nothing about the newer version. A warning that links each
 * cell, for editors to check the new document and correct the rating if it now says something; never a refusal.
 */
export const RecheckList = ({
  rechecks,
  base,
  locale,
  defaultLocale,
  withParty = true,
  level,
}: {
  rechecks: Recheck[];
  /** The election's admin address, which cells sit under. */
  base: string;
  locale: string;
  defaultLocale: string;
  /** Whether to name each cell's party (not on the party's own page). */
  withParty?: boolean;
  /** Its heading's level, by where it stands in the page's outline. */
  level: 2 | 3 | 4;
}) => {
  if (rechecks.length === 0) {
    return null;
  }
  const t = getTranslator(locale as Parameters<typeof getTranslator>[0]);
  const Heading = `h${level}` as const;
  return (
    <section aria-labelledby="rechecks" className={styles.notice}>
      <Heading id="rechecks" className={level === 2 ? styles.h2 : styles.h3}>
        <span aria-hidden="true">⚠ </span>
        {t('admin.rechecks.title', { count: rechecks.length })}
      </Heading>
      <p className={styles.text}>{t('admin.rechecks.body')}</p>
      <ul className={styles.list}>
        {rechecks.map((recheck) => {
          const party = inLanguage(recheck.party.name, locale, defaultLocale);
          const criterion = inLanguage(recheck.criterion.title, locale, defaultLocale);
          return (
            <li key={`${recheck.party.id}-${recheck.criterion.id}`}>
              <Link
                className={styles.link}
                href={`${base}/cells/${recheck.party.id}/${recheck.criterion.id}`}
              >
                {withParty ? (
                  <>
                    {party ? <Lang value={party} page={locale} /> : recheck.party.slug}
                    {' · '}
                  </>
                ) : null}
                {criterion ? <Lang value={criterion} page={locale} /> : recheck.criterion.slug}
              </Link>{' '}
              <span className={styles.hint}>
                {t('admin.rechecks.replacedOn', { date: new Date(recheck.replacedAt) })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
