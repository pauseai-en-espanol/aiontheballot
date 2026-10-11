import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getOrganization } from '@/data';
import { getLocale } from '@/locale';
import { linkedSiteName, organizationName } from '@/localized';
import { organizationFormText, organizationLocales } from '@/organizations/forms';
import { OrganizationForm } from '@/organizations/OrganizationForm';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

type Params = { params: Promise<{ id: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const found = await getOrganization((await params).id);
  const locale = await getLocale();
  return {
    title: found
      ? organizationName(found.organization, locale).text
      : getTranslator(locale)('admin.notFound.title'),
  };
};

/** An organization (editorial workflow P2.1), and the sites it runs or endorses. */
const OrganizationPage = async ({ params }: Params) => {
  const found = await getOrganization((await params).id);
  if (!found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { organization } = found;
  return (
    <>
      <p>
        <Link className={styles.link} href="/platform/organizations">
          {t('admin.organizations.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>
        <Lang value={organizationName(organization, locale)} page={locale} />
      </h1>
      <h2 className={styles.h2}>{t('admin.organizations.sites')}</h2>
      {organization.tenants.length === 0 ? (
        <p className={styles.text}>{t('admin.organizations.noSites')}</p>
      ) : (
        <ul className={styles.list}>
          {organization.tenants.map((site) => (
            <li key={site.slug}>
              <Lang value={linkedSiteName(site, locale)} page={locale} /> (
              {t(`admin.organizations.roles.${site.role}`)})
            </li>
          ))}
        </ul>
      )}
      <h2 className={styles.h2}>{t('admin.organizations.details')}</h2>
      <OrganizationForm
        locales={organizationLocales(found.languages, locale)}
        organization={organization}
        text={organizationFormText(t, t('admin.organizations.form.save'))}
      />
    </>
  );
};

export default OrganizationPage;
