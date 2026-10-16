import type { Metadata } from 'next';

import { sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { CriterionForm } from '@/elections/CriterionForm';
import { editedDirectly, getCriteria, getElection } from '@/elections/data';
import { criterionFormText } from '@/elections/structure-text';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async (): Promise<Metadata> => {
  const t = getTranslator(await getLocale());
  return { title: `${t('admin.criteria.add')} · ${t('admin.election.criteria')}` };
};

/** One criterion of a draft election (editorial workflow E4), added at the end of the list. */
const NewCriterionPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
  const [overview, found, data] = await Promise.all([
    getTenant(slug),
    getElection(slug, electionSlug),
    getCriteria(slug, electionSlug),
  ]);
  if (!overview || !found || !data) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const { election } = found;
  const base = `/t/${tenant.slug}/e/${election.slug}/criteria`;
  const api = `/api/t/${tenant.slug}/e/${election.slug}/criteria`;
  const editable = data.canEdit && editedDirectly(election.status);
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.election.criteria')}
        </Link>
      </p>
      <h2 className={styles.h2}>{t('admin.criteria.add')}</h2>
      {editable ? (
        <CriterionForm
          path={api}
          method="POST"
          then={base}
          coreCriteria={data.coreCriteria.map((core) => {
            const title = inLanguage(core.title, locale, tenant.defaultLocale) ?? {
              text: core.key,
              lang: locale,
            };
            return { id: core.id, title: title.text, lang: title.lang };
          })}
          locales={localeOptions(tenant, locale)}
          slugAddress={sitePath(tenant.defaultLocale, {
            page: 'criterion',
            election: election.slug,
            criterion: '{slug}',
          })}
          text={criterionFormText(t, false)}
        />
      ) : (
        <p className={styles.text}>{t('admin.structure.readOnly')}</p>
      )}
    </>
  );
};

export default NewCriterionPage;
