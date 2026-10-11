import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSite } from '@/data';
import { getLocale } from '@/locale';
import { organizationName, siteName } from '@/localized';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Lang } from '@/ui/Lang';
import { languageName } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

interface SiteParams {
  params: Promise<{ slug: string }>;
}

export const generateMetadata = async ({ params }: SiteParams): Promise<Metadata> => {
  const locale = await getLocale();
  const found = await getSite((await params).slug);
  return {
    title: found
      ? siteName(found.site, locale).text
      : getTranslator(locale)('admin.notFound.title'),
  };
};

/** A site: its details, whether it is on, and its addresses (PLAN R129). */
const SitePage = async ({ params }: SiteParams) => {
  const found = await getSite((await params).slug);
  if (!found) {
    notFound();
  }
  const { site } = found;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const errors = writeErrors(t);
  return (
    <>
      <p>
        <Link className={styles.link} href="/platform/sites">
          {t('admin.platformSites.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>
        <Lang value={siteName(site, locale)} page={locale} />
      </h1>
      <section aria-labelledby="details" className={styles.section}>
        <h2 id="details" className={styles.h2}>
          {t('admin.platformSites.details')}
        </h2>
        <dl className={styles.facts}>
          <dt>{t('admin.platformSites.form.slug')}</dt>
          <dd>{site.slug}</dd>
          <dt>{t('admin.platformSites.country')}</dt>
          <dd>{site.countryCode}</dd>
          <dt>{t('admin.platformSites.languages')}</dt>
          <dd>
            {[
              site.defaultLocale,
              ...site.enabledLocales.filter((code) => code !== site.defaultLocale),
            ]
              .map((code) => languageName(code, locale))
              .join(', ')}
          </dd>
          <dt>{t('admin.platformSites.methodologyKind')}</dt>
          <dd>{t(`admin.methodology.kindNames.${site.methodologyKind}`)}</dd>
          <dt>{t('admin.platformSites.operator')}</dt>
          <dd>
            {site.operator ? (
              <Link
                className={styles.link}
                href={`/platform/organizations/${encodeURIComponent(site.operator.id)}`}
              >
                <Lang
                  value={organizationName(
                    { displayName: site.operator.name, legalName: site.operator.legalName },
                    locale,
                  )}
                  page={locale}
                />
              </Link>
            ) : (
              t('admin.platformSites.noOperator')
            )}
          </dd>
          <dt>{t('admin.platformSites.reportRetention')}</dt>
          <dd>{t('admin.settings.retention.days', { days: site.reportRetentionDays })}</dd>
        </dl>
      </section>
      <section aria-labelledby="active" className={styles.section}>
        <h2 id="active" className={styles.h2}>
          {t('admin.platformSites.active.title')}
        </h2>
        <p className={styles.text}>
          {site.active ? t('admin.platformSites.active.on') : t('admin.platformSites.active.off')}
        </p>
        <ConfirmButton
          method="PUT"
          path={`/api/sites/${encodeURIComponent(site.slug)}/active`}
          body={{ active: !site.active }}
          secondary={site.active}
          text={
            site.active
              ? {
                  button: t('admin.platformSites.active.turnOff'),
                  title: t('admin.platformSites.active.turnOffTitle'),
                  body: t('admin.platformSites.active.turnOffBody'),
                  confirm: t('admin.platformSites.active.turnOff'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.active.turnedOff'),
                  errors,
                }
              : {
                  button: t('admin.platformSites.active.turnOn'),
                  title: t('admin.platformSites.active.turnOnTitle'),
                  body: t('admin.platformSites.active.turnOnBody'),
                  confirm: t('admin.platformSites.active.turnOn'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.active.turnedOn'),
                  errors: { ...errors, incomplete: t('admin.platformSites.constraints.operator') },
                }
          }
        />
      </section>
      <section aria-labelledby="hostnames" className={styles.section}>
        <h2 id="hostnames" className={styles.h2}>
          {t('admin.platformSites.hostname.title')}
        </h2>
        <p className={styles.text}>{t('admin.platformSites.hostname.intro')}</p>
        {site.hostnames.length === 0 ? (
          <p className={styles.text}>{t('admin.platformSites.noHostnames')}</p>
        ) : (
          <ul className={styles.list}>
            {site.hostnames.map((hostname) => (
              <li key={hostname.hostname}>
                {hostname.hostname}
                {hostname.canonical ? ` (${t('admin.platformSites.canonical')})` : ''}
                {hostname.retired ? ` (${t('admin.platformSites.retired')})` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
};

export default SitePage;
