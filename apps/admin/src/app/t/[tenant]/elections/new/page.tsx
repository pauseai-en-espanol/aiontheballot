import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant, mayAct } from '@/data';
import { ElectionForm } from '@/elections/ElectionForm';
import { electionConstraints, electionFormText } from '@/elections/forms';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { requireStage } from '@/session';
import { localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ tenant: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.elections.new')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/** A new election (editorial workflow E1.1): always a draft. */
const NewElectionPage = async ({ params }: Params) => {
  await requireStage('signed-in');
  const overview = await getTenant((await params).tenant);
  if (!overview) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  return (
    <>
      <p>
        <Link className={styles.link} href={`/t/${tenant.slug}/elections`}>
          {t('admin.elections.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t('admin.elections.new')}</h1>
      <p className={styles.text}>{t('admin.elections.newIntro')}</p>
      {mayAct(overview, 'country_admin', 'editor') ? (
        <ElectionForm
          tenant={tenant.slug}
          countryCode={tenant.countryCode}
          locales={localeOptions(tenant, locale)}
          text={{
            ...electionFormText(t, t('admin.elections.form.create')),
            constraints: electionConstraints(t),
          }}
        />
      ) : (
        <p className={styles.text}>{t('errors.forbidden')}</p>
      )}
    </>
  );
};

export default NewElectionPage;
