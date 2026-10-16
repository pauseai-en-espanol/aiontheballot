import type { Metadata } from 'next';

import { getTranslator, LOCALES } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSite, getSites } from '@/data';
import { getLocale } from '@/locale';
import { organizationName, siteName } from '@/localized';
import { AnalyticsForm } from '@/sites/AnalyticsForm';
import { SiteDetailsForm } from '@/sites/SiteDetailsForm';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { FormSection } from '@/ui/FormSection';
import { Lang } from '@/ui/Lang';
import { languageName } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { problemText, template, writeErrors } from '@/ui/text';

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

/**
 * A site: its details, of which its name, languages and operator change here (PLAN R195), whether it is on, its public
 * settings (open, indexed, counted: PLAN R135), and its addresses (PLAN R129).
 */
const SitePage = async ({ params }: SiteParams) => {
  const [found, sites] = await Promise.all([getSite((await params).slug), getSites()]);
  if (!found || !sites) {
    notFound();
  }
  const { site } = found;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const errors = writeErrors(t);
  // Visits are counted on the site's main address only (PLAN R135): the Plausible site is named after it.
  const mainAddress = site.hostnames.find((h) => h.canonical && !h.retired)?.hostname;
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
          <dt>{t('admin.form.slug.label')}</dt>
          <dd>{site.slug}</dd>
          <dt>{t('admin.platformSites.country')}</dt>
          <dd>{site.countryCode}</dd>
          <dt>{t('admin.platformSites.methodologyKind')}</dt>
          <dd>{t(`admin.methodology.kindLabels.${site.methodologyKind}`)}</dd>
          <dt>{t('admin.platformSites.reportRetention')}</dt>
          <dd>{t('admin.settings.retention.days', { days: site.reportRetentionDays })}</dd>
        </dl>
        <SiteDetailsForm
          slug={site.slug}
          defaultLocale={site.defaultLocale}
          enabledLocales={site.enabledLocales}
          name={site.name}
          operatorId={site.operator?.id ?? null}
          locales={[
            site.defaultLocale,
            ...LOCALES.filter((code) => code !== site.defaultLocale),
          ].map((code) => ({
            code,
            label: languageName(code, locale),
            required: code === site.defaultLocale,
          }))}
          organizations={sites.organizations.map((organization) => {
            const shown = organizationName(organization, locale);
            return { id: organization.id, name: shown.text, lang: shown.lang };
          })}
          text={{
            name: t('admin.platformSites.form.name'),
            nameHint: t('admin.platformSites.form.nameHint'),
            needed: t('admin.localized.needed'),
            languages: t('admin.platformSites.languages'),
            mainLanguage: template(t, 'admin.platformSites.detailsForm.mainLanguage'),
            operator: t('admin.platformSites.form.operator'),
            operatorHint: t('admin.platformSites.form.operatorHint'),
            chooseOperator: t('admin.platformSites.form.chooseOperator'),
            restrictedOperator: t('admin.platformSites.detailsForm.restrictedOperator'),
            save: t('admin.platformSites.detailsForm.save'),
            saved: t('admin.platformSites.detailsForm.saved'),
            confirmTitle: t('admin.platformSites.detailsForm.confirmTitle'),
            operatorChange: template(t, 'admin.platformSites.detailsForm.operatorChange'),
            languagesRemoved: template(t, 'admin.platformSites.detailsForm.languagesRemoved'),
            confirm: t('admin.platformSites.detailsForm.confirm'),
            cancel: t('admin.members.cancel'),
            errors,
            problems: problemText(t),
          }}
        />
      </section>
      <FormSection id="active" title={t('admin.platformSites.active.title')}>
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
      </FormSection>
      <FormSection id="open" title={t('admin.platformSites.open.title')}>
        <p className={styles.text}>
          {site.open ? t('admin.platformSites.open.on') : t('admin.platformSites.open.off')}
        </p>
        <ConfirmButton
          method="PUT"
          path={`/api/sites/${encodeURIComponent(site.slug)}/open`}
          body={{ open: !site.open }}
          secondary={site.open}
          text={
            site.open
              ? {
                  button: t('admin.platformSites.open.close'),
                  title: t('admin.platformSites.open.closeTitle'),
                  body: t('admin.platformSites.open.closeBody'),
                  confirm: t('admin.platformSites.open.close'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.open.closed'),
                  errors,
                }
              : {
                  button: t('admin.platformSites.open.openSite'),
                  title: t('admin.platformSites.open.openTitle'),
                  body: t('admin.platformSites.open.openBody'),
                  confirm: t('admin.platformSites.open.openSite'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.open.opened'),
                  errors,
                }
          }
        />
      </FormSection>
      <FormSection id="indexing" title={t('admin.platformSites.indexing.title')}>
        <p className={styles.text}>
          {site.indexed
            ? t('admin.platformSites.indexing.on')
            : t('admin.platformSites.indexing.off')}
        </p>
        <ConfirmButton
          method="PUT"
          path={`/api/sites/${encodeURIComponent(site.slug)}/indexing`}
          body={{ indexed: !site.indexed }}
          secondary
          text={
            site.indexed
              ? {
                  button: t('admin.platformSites.indexing.hide'),
                  title: t('admin.platformSites.indexing.hideTitle'),
                  body: t('admin.platformSites.indexing.hideBody'),
                  confirm: t('admin.platformSites.indexing.hide'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.indexing.hidden'),
                  errors,
                }
              : {
                  button: t('admin.platformSites.indexing.show'),
                  title: t('admin.platformSites.indexing.showTitle'),
                  body: t('admin.platformSites.indexing.showBody'),
                  confirm: t('admin.platformSites.indexing.show'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.platformSites.indexing.shown'),
                  errors,
                }
          }
        />
      </FormSection>
      <FormSection
        id="analytics"
        title={t('admin.platformSites.analytics.title')}
        description={t('admin.platformSites.analytics.intro')}
      >
        <AnalyticsForm
          path={`/api/sites/${encodeURIComponent(site.slug)}/analytics`}
          value={site.plausibleScript}
          text={{
            script: t('admin.platformSites.analytics.script'),
            scriptHint: mainAddress
              ? t('admin.platformSites.analytics.scriptHint', { host: mainAddress })
              : t('admin.platformSites.analytics.noAddress'),
            optional: t('admin.form.optional'),
            invalid: t('admin.platformSites.analytics.invalid'),
            save: t('admin.platformSites.analytics.save'),
            saved: t('admin.platformSites.analytics.saved'),
            errors,
          }}
        />
      </FormSection>
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
