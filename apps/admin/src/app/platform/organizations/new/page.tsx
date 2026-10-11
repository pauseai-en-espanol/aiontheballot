import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getOrganizations } from '@/data';
import { getLocale } from '@/locale';
import { organizationFormText, organizationLocales } from '@/organizations/forms';
import { OrganizationForm } from '@/organizations/OrganizationForm';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.organizations.new'),
});

/** A new organization (editorial workflow P2.1). */
const NewOrganizationPage = async () => {
  const found = await getOrganizations();
  if (!found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <p>
        <Link className={styles.link} href="/platform/organizations">
          {t('admin.organizations.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t('admin.organizations.new')}</h1>
      <p className={styles.text}>{t('admin.organizations.newIntro')}</p>
      <OrganizationForm
        locales={organizationLocales(found.languages, locale)}
        text={organizationFormText(t, t('admin.organizations.form.create'))}
      />
    </>
  );
};

export default NewOrganizationPage;
