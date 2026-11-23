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
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('correctionsPage.title'),
});

/**
 * The election's corrections log as the public will see it (editorial workflow H1.4): every later revision of a cell
 * and every approved structural change, newest first, each with its public note, linking to the cell or the change
 * requests. The public site's page shows the same entries, but for those taken out of it (PLAN R248): they stay here,
 * marked, so a country admin or platform admin can put them back.
 */
const CorrectionsPage = async ({ params }: Params) => {
  const { tenant: slug, election } = await params;
  const [overview, log] = await Promise.all([getTenant(slug), getCorrections(slug, election)]);
  if (!overview || !log) {
    notFound();
  }
  const { entries, canRemove } = log;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const local = (value: Parameters<typeof inLanguage>[0]) =>
    inLanguage(value, locale, tenant.defaultLocale);
  const base = `/t/${tenant.slug}/e/${election}`;
  const removal = (id: string) => `/api/t/${tenant.slug}/e/${election}/corrections/${id}/removal`;
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
            const action = t(`admin.changes.actions.${entry.action}`, {
              // Its field, or each of a set's (PLAN R183), by their names.
              field: list.format(
                fieldChanges(entry.field, entry.previousValue, entry.newValue).map(({ field }) =>
                  (labels[field] ?? field).toLocaleLowerCase(locale),
                ),
              ),
            });
            // What its button acts on, in words, since every entry has the same one.
            const what = `${action}, ${target}, ${date}`;
            return (
              <li key={entry.id}>
                <p>
                  <strong>{action}</strong> · {date} ·{' '}
                  {t(`admin.changes.kinds.${entry.targetKind as 'election'}`)} {target} ·{' '}
                  <Link className={styles.link} href={`${base}/changes`}>
                    {t('admin.election.changes')}
                  </Link>
                </p>
                {note ? (
                  <p className={styles.text}>
                    <Lang value={note} page={locale} />
                  </p>
                ) : null}
                {entry.removed ? (
                  <p className={styles.notice}>{t('admin.correctionsLog.mark')}</p>
                ) : null}
                {canRemove && entry.removed ? (
                  <ConfirmButton
                    method="DELETE"
                    path={removal(entry.id)}
                    removes
                    text={{
                      button: t('admin.correctionsLog.restore'),
                      label: `${t('admin.correctionsLog.restore')}: ${what}`,
                      title: t('admin.correctionsLog.restoreTitle'),
                      body: t('admin.correctionsLog.restoreBody'),
                      confirm: t('admin.correctionsLog.restore'),
                      cancel: t('admin.members.cancel'),
                      done: t('admin.correctionsLog.restored'),
                      errors: writeErrors(t),
                    }}
                  />
                ) : null}
                {canRemove && !entry.removed && entry.replaced ? (
                  <ConfirmButton
                    method="POST"
                    path={removal(entry.id)}
                    removes
                    text={{
                      button: t('admin.correctionsLog.remove'),
                      label: `${t('admin.correctionsLog.remove')}: ${what}`,
                      title: t('admin.correctionsLog.removeTitle'),
                      body: t('admin.correctionsLog.removeBody'),
                      confirm: t('admin.correctionsLog.remove'),
                      cancel: t('admin.members.cancel'),
                      done: t('admin.correctionsLog.removed'),
                      errors: writeErrors(t),
                    }}
                  />
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
