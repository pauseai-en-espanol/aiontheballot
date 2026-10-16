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
import { ConfirmButton } from '@/ui/ConfirmButton';
import { FormSection } from '@/ui/FormSection';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string; id: string }> };

export const generateMetadata = async (): Promise<Metadata> => {
  const t = getTranslator(await getLocale());
  return { title: `${t('admin.criteria.edit')} · ${t('admin.election.criteria')}` };
};

/** One criterion of a draft election (editorial workflow E4), changed or deleted while the election is a draft. */
const CriterionPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug, id } = await params;
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
  const item = data.criteria.find((candidate) => candidate.id === id);
  if (!item) {
    notFound();
  }
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.election.criteria')}
        </Link>
      </p>
      <h2 className={styles.h2}>{t('admin.criteria.edit')}</h2>
      {editable ? (
        <>
          <CriterionForm
            path={`${api}/${item.id}`}
            method="PUT"
            then={base}
            values={{
              slug: item.slug,
              title: item.title,
              shortTitle: item.shortTitle,
              description: item.description,
              coreCriterionId: item.coreCriterionId,
            }}
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
            text={criterionFormText(t, true)}
          />
          <FormSection id="delete" level={3} danger title={t('admin.criteria.delete')}>
            <ConfirmButton
              method="DELETE"
              path={`${api}/${item.id}`}
              then={base}
              text={{
                button: t('admin.criteria.delete'),
                title: t('admin.criteria.deleteTitle'),
                body: t('admin.criteria.deleteBody'),
                confirm: t('admin.criteria.delete'),
                cancel: t('admin.members.cancel'),
                done: '',
                errors: { ...writeErrors(t), linked: t('admin.structure.deleteLinked') },
              }}
            />
          </FormSection>
        </>
      ) : election.status === 'live' && data.canEdit && !item.retired ? (
        // Live: its fields change through change requests (CR1).
        <ul className={styles.list}>
          <li>
            <Link
              className={styles.link}
              href={`/t/${tenant.slug}/e/${election.slug}/changes/new?target=criterion&id=${item.id}`}
            >
              {t('admin.changes.proposeHere')}
            </Link>
          </li>
          <li>
            <Link
              className={styles.link}
              href={`/t/${tenant.slug}/e/${election.slug}/changes/new?target=criterion&id=${item.id}&action=retire`}
            >
              {t('admin.changes.retire')}
            </Link>
          </li>
        </ul>
      ) : (
        <p className={styles.text}>{t('admin.structure.readOnly')}</p>
      )}
    </>
  );
};

export default CriterionPage;
