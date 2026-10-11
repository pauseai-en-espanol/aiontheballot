import type { Metadata } from 'next';

import { getTranslator, LOCALES } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSites } from '@/data';
import { getLocale } from '@/locale';
import { organizationName } from '@/localized';
import { SiteForm } from '@/sites/SiteForm';
import { languageName } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.platformSites.new'),
});

/** A new site, created off (PLAN R129). */
const NewSitePage = async () => {
  const found = await getSites();
  if (!found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <>
      <p>
        <Link className={styles.link} href="/platform/sites">
          {t('admin.platformSites.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t('admin.platformSites.new')}</h1>
      <p className={styles.text}>{t('admin.platformSites.newIntro')}</p>
      <SiteForm
        locales={LOCALES.map((code) => ({
          code,
          label: languageName(code, locale),
          required: false,
        }))}
        organizations={found.organizations.map((organization) => {
          const name = organizationName(organization, locale);
          return { id: organization.id, name: name.text, lang: name.lang };
        })}
        text={{
          slug: t('admin.platformSites.form.slug'),
          slugHint: t('admin.platformSites.form.slugHint'),
          name: t('admin.platformSites.form.name'),
          nameHint: t('admin.platformSites.form.nameHint'),
          needed: t('admin.localized.needed'),
          countryCode: t('admin.platformSites.form.countryCode'),
          countryCodeHint: t('admin.platformSites.form.countryCodeHint'),
          defaultLocale: t('admin.platformSites.form.defaultLocale'),
          enabledLocales: t('admin.platformSites.form.enabledLocales'),
          methodologyKind: t('admin.platformSites.form.methodologyKind'),
          methodologyKindHint: t('admin.platformSites.form.methodologyKindHint'),
          kinds: {
            demands: t('admin.methodology.kindNames.demands'),
            descriptive: t('admin.methodology.kindNames.descriptive'),
          },
          operator: t('admin.platformSites.form.operator'),
          operatorHint: t('admin.platformSites.form.operatorHint'),
          chooseOperator: t('admin.platformSites.form.chooseOperator'),
          reportRetentionDays: t('admin.platformSites.form.reportRetentionDays'),
          create: t('admin.platformSites.form.create'),
          created: t('admin.platformSites.form.created'),
          errors: writeErrors(t),
          constraints: {
            slug_check: t('admin.platformSites.constraints.slug'),
            slug_length: t('admin.platformSites.constraints.slug'),
            tenants_slug_key: t('admin.platformSites.constraints.slugTaken'),
            tenants_country_code_check: t('admin.platformSites.constraints.countryCode'),
            tenants_report_retention_days_check: t('admin.platformSites.constraints.retention'),
            tenants_report_retention_days_max: t('admin.platformSites.constraints.retention'),
            localized_check: t('admin.platformSites.constraints.name'),
          },
        }}
      />
    </>
  );
};

export default NewSitePage;
