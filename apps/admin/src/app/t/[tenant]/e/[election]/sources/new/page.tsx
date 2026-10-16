import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getParties } from '@/elections/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { getSources } from '@/sources/data';
import { SourceForm } from '@/sources/SourceForm';
import { sourceCopyChoice, sourceFormText } from '@/sources/text';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => {
  const t = getTranslator(await getLocale());
  return { title: `${t('admin.sources.add')} · ${t('admin.sources.title')}` };
};

/** A new source (editorial workflow S1.1), whose own page then takes its copy. */
const NewSourcePage = async ({ params }: Params) => {
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
  const { tenant } = overview;
  const base = `/t/${tenant.slug}/e/${election}/sources`;
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.sources.back')}
        </Link>
      </p>
      <h2 className={styles.h2}>{t('admin.sources.add')}</h2>
      {data.canEdit ? (
        <SourceForm
          path={`/api/t/${tenant.slug}/e/${election}/sources`}
          method="POST"
          then={base}
          parties={structure.parties
            .filter((party) => !party.retired)
            .map((party) => {
              const name = inLanguage(party.name, locale, tenant.defaultLocale) ?? {
                text: party.slug,
                lang: locale,
              };
              return { id: party.id, name: name.text, lang: name.lang };
            })}
          siteLanguages={[
            tenant.defaultLocale,
            ...tenant.enabledLocales.filter((code) => code !== tenant.defaultLocale),
          ]}
          locale={locale}
          copy={sourceCopyChoice(t, {
            uploads: data.uploads,
            fetching: data.uploads && data.fetching === true,
          })}
          text={sourceFormText(t)}
        />
      ) : (
        <p className={styles.text}>{t('admin.sources.readOnly')}</p>
      )}
    </>
  );
};

export default NewSourcePage;
