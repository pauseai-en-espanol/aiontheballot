import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getParties } from '@/elections/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { getSources, type Source } from '@/sources/data';
import { sourceKinds } from '@/sources/text';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.sources.title'),
});

/**
 * An election's sources (editorial workflow S3.4): programmes first, each with its party, kind, state in words, whether
 * cells can cite it, and how often they do.
 */
const SourcesPage = async ({ params }: Params) => {
  const { tenant: slug, election } = await params;
  const [overview, data, structure] = await Promise.all([
    getTenant(slug),
    getSources(slug, election),
    getParties(slug, election),
  ]);
  if (!overview || !data || !structure) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const kinds = sourceKinds(t);
  const base = `/t/${overview.tenant.slug}/e/${election}/sources`;
  const parties = new Map(structure.parties.map((party) => [party.id, party]));
  const partyName = (id: string | null) => {
    const party = id ? parties.get(id) : undefined;
    return party
      ? (inLanguage(party.shortName, locale, overview.tenant.defaultLocale) ?? {
          text: party.slug,
          lang: locale,
        })
      : { text: t('admin.sources.neutral'), lang: locale };
  };
  const state = (source: Source) =>
    [
      source.copy
        ? t(`admin.sources.states.${source.extractionStatus}`)
        : t('admin.sources.states.noCopy'),
      source.citable ? t('admin.sources.citable') : t('admin.sources.notCitable'),
      ...(source.replacedAt ? [t('admin.sources.replaced')] : []),
    ].join(' · ');
  return (
    <>
      <h2 className={styles.h2}>{t('admin.sources.title')}</h2>
      <p className={styles.text}>{t('admin.sources.intro')}</p>
      {data.sources.length === 0 ? (
        <p className={styles.text}>{t('admin.sources.none')}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption>{t('admin.sources.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.sources.columns.title')}</th>
                <th scope="col">{t('admin.sources.columns.party')}</th>
                <th scope="col">{t('admin.sources.columns.kind')}</th>
                <th scope="col">{t('admin.sources.columns.state')}</th>
                <th scope="col">{t('admin.sources.columns.citations')}</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((source) => (
                <tr key={source.id}>
                  <th scope="row">
                    <Link
                      className={styles.link}
                      href={`${base}/${source.id}`}
                      lang={source.language ?? undefined}
                    >
                      {source.title}
                    </Link>
                    {source.isProgramme ? <> ({t('admin.sources.programmeTag')})</> : null}
                  </th>
                  <td>
                    <Lang value={partyName(source.partyId)} page={locale} />
                  </td>
                  <td>{kinds[source.kind]}</td>
                  <td>{state(source)}</td>
                  <td>{t('admin.sources.citations', { count: source.citations })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.canEdit ? (
        <p>
          <Link className={styles.button} href={`${base}/new`}>
            {t('admin.sources.add')}
          </Link>
        </p>
      ) : null}
    </>
  );
};

export default SourcesPage;
