import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { fieldLabels } from '@/changes/text';
import { fieldChanges } from '@/changes/values';
import { getCorrections } from '@/corrections/data';
import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('correctionsPage.title'),
});

/**
 * The election's corrections log as the public will see it (editorial workflow H1.4): every later revision of a cell
 * and every approved structural change, newest first, each with its public note, linking to the cell or the change
 * requests. The public site's page shows the same entries.
 */
const CorrectionsPage = async ({ params }: Params) => {
  const { tenant: slug, election } = await params;
  const [overview, entries] = await Promise.all([getTenant(slug), getCorrections(slug, election)]);
  if (!overview || !entries) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const local = (value: Parameters<typeof inLanguage>[0]) =>
    inLanguage(value, locale, tenant.defaultLocale);
  const base = `/t/${tenant.slug}/e/${election}`;
  const labels = fieldLabels(t);
  const list = new Intl.ListFormat(locale, { type: 'conjunction' });
  return (
    <>
      <h2 className={styles.h2}>{t('correctionsPage.title')}</h2>
      <p className={styles.text}>{t('correctionsPage.lead')}</p>
      {entries.length === 0 ? (
        <p className={styles.text}>{t('correctionsPage.empty')}</p>
      ) : (
        <ol className={styles.list}>
          {entries.map((entry) => {
            const date = new Date(entry.at).toLocaleString(locale, {
              dateStyle: 'long',
              timeStyle: 'short',
            });
            const note = entry.publicNote ? local(entry.publicNote) : undefined;
            if (entry.kind === 'revision') {
              const party = local(entry.party.name);
              const criterion = local(entry.criterion.title);
              return (
                <li key={`r-${entry.party.slug}-${entry.criterion.slug}-${entry.revisionNo}`}>
                  <p>
                    <strong>{t(`cellPage.change.${entry.change}`)}</strong> · {date} ·{' '}
                    <Link
                      className={styles.link}
                      // The admin's cells are addressed by id, the public site's by slug.
                      href={`${base}/cells/${entry.party.id}/${entry.criterion.id}`}
                    >
                      {party ? <Lang value={party} page={locale} /> : entry.party.slug} ·{' '}
                      {criterion ? <Lang value={criterion} page={locale} /> : entry.criterion.slug}
                    </Link>
                  </p>
                  {note ? (
                    <p className={styles.text}>
                      <Lang value={note} page={locale} />
                    </p>
                  ) : null}
                </li>
              );
            }
            const target =
              typeof entry.target === 'string'
                ? entry.target
                : entry.target
                  ? (local(entry.target)?.text ?? '')
                  : '';
            return (
              <li key={`s-${entry.at}-${entry.targetKind}-${entry.field ?? ''}`}>
                <p>
                  <strong>
                    {t(`admin.changes.actions.${entry.action}`, {
                      // Its field, or each of a set's (PLAN R183), by their names.
                      field: list.format(
                        fieldChanges(entry.field, entry.previousValue, entry.newValue).map(
                          ({ field }) => (labels[field] ?? field).toLocaleLowerCase(locale),
                        ),
                      ),
                    })}
                  </strong>{' '}
                  · {date} · {t(`admin.changes.kinds.${entry.targetKind as 'election'}`)} {target} ·{' '}
                  <Link className={styles.link} href={`${base}/changes`}>
                    {t('admin.election.changes')}
                  </Link>
                </p>
                {note ? (
                  <p className={styles.text}>
                    <Lang value={note} page={locale} />
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
};

export default CorrectionsPage;
