import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { editedDirectly, getCriteria, getElection } from '@/elections/data';
import { OrderedList } from '@/elections/OrderedList';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import * as styles from '@/ui/styles';
import { template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant, election } = await params;
  const [overview, found] = await Promise.all([getTenant(tenant), getElection(tenant, election)]);
  const locale = await getLocale();
  const t = getTranslator(locale);
  if (!overview || !found) {
    return { title: t('admin.notFound.title') };
  }
  const name = inLanguage(found.election.name, locale, overview.tenant.defaultLocale)?.text;
  return { title: `${t('admin.election.criteria')} · ${name ?? election}` };
};

/**
 * An election's criteria in their display order (editorial workflow E4): editors add, change, reorder and delete them
 * while the election is a draft; once it is live they change only through change requests.
 */
const CriterionListPage = async ({ params }: Params) => {
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
  const editable = data.canEdit && editedDirectly(election.status);
  const base = `/t/${tenant.slug}/e/${election.slug}/criteria`;
  const items = data.criteria.map((item) => {
    const name = inLanguage(item.title, locale, tenant.defaultLocale) ?? {
      text: item.slug,
      lang: locale,
    };
    return {
      id: item.id,
      name: name.text,
      lang: name.lang,
      details: [item.slug, ...(item.retired ? [t('admin.structure.retired')] : [])],
      href: `${base}/${item.id}`,
    };
  });
  return (
    <>
      <h2 className={styles.h2}>{t('admin.election.criteria')}</h2>
      <p className={styles.text}>{t('admin.criteria.intro')}</p>
      {items.length === 0 ? (
        <p className={styles.text}>{t('admin.criteria.none')}</p>
      ) : (
        <OrderedList
          items={items}
          orderPath={`/api/t/${tenant.slug}/e/${election.slug}/criteria/order`}
          canReorder={editable}
          label={t('admin.election.criteria')}
          text={{
            up: t('admin.structure.up'),
            down: t('admin.structure.down'),
            upLabel: template(t, 'admin.structure.upLabel'),
            downLabel: template(t, 'admin.structure.downLabel'),
            moved: template(t, 'admin.structure.moved'),
            errors: writeErrors(t),
          }}
        />
      )}
      {editable ? (
        <p>
          <Link className={styles.button} href={`${base}/new`}>
            {t('admin.criteria.add')}
          </Link>
        </p>
      ) : null}
    </>
  );
};

export default CriterionListPage;
