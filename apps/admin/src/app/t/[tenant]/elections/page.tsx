import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getElections } from '@/elections/data';
import { electionDate, electionTypes } from '@/elections/text';
import { getLocale } from '@/locale';
import { inLanguage, siteName } from '@/localized';
import { requireStage } from '@/session';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.elections.title')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/** A tenant's elections (editorial workflow §6, screen 6): every member sees them; editors create them. */
const ElectionsPage = async ({ params }: Params) => {
  await requireStage('signed-in');
  const { tenant: slug } = await params;
  const [overview, list] = await Promise.all([getTenant(slug), getElections(slug)]);
  if (!overview || !list) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const types = electionTypes(t);
  const { tenant } = overview;
  return (
    <>
      <h1 className={styles.h1}>{t('admin.elections.title')}</h1>
      <p className={styles.text}>{t('admin.elections.intro')}</p>
      {list.canCreate ? (
        <p>
          <Link className={styles.button} href={`/t/${tenant.slug}/elections/new`}>
            {t('admin.elections.new')}
          </Link>
        </p>
      ) : null}
      {list.elections.length === 0 ? (
        <p className={styles.text}>{t('admin.elections.none')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>
              {t('admin.elections.tableLabel', { site: siteName(tenant, locale).text })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.elections.name')}</th>
                <th scope="col">{t('admin.elections.date')}</th>
                <th scope="col">{t('admin.elections.type')}</th>
                <th scope="col">{t('admin.elections.status')}</th>
              </tr>
            </thead>
            <tbody>
              {list.elections.map((election) => {
                const name = inLanguage(election.name, locale, tenant.defaultLocale) ?? {
                  text: election.slug,
                  lang: locale,
                };
                return (
                  <tr key={election.id}>
                    <th scope="row">
                      <Link className={styles.link} href={`/t/${tenant.slug}/e/${election.slug}`}>
                        <Lang value={name} page={locale} />
                      </Link>
                    </th>
                    <td>{electionDate(t, election.date)}</td>
                    <td>
                      {types[election.type]}
                      {election.territoryCode ? ` (${election.territoryCode})` : null}
                    </td>
                    <td>
                      {t(`admin.elections.statuses.${election.status}`)}
                      {election.announced ? `, ${t('admin.elections.announced')}` : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

export default ElectionsPage;
