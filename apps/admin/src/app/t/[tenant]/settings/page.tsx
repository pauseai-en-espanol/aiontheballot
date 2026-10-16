import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { roles } from '@aiontheballot/ui/brand';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { imageFieldText } from '@/changes/text';
import { DOCUMENT_KINDS, getBrand, getDocuments, getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { BrandImagesForm } from '@/settings/BrandImagesForm';
import { ColourForm, LiveEditsForm, RetentionForm } from '@/settings/SettingsForms';
import { FormSection } from '@/ui/FormSection';
import * as styles from '@/ui/styles';
import { problemText, template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.settings.title')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/**
 * A tenant's settings (editorial workflow §5, P1): every member sees them (P1.3); country admins choose the site's
 * colour (T1, PLAN R178), change the report retention and write the policy texts, and only platform admins whether
 * live edits need a second approver. Each in a part of its own (admin forms §1.4). Country admins also set the site's
 * logos and icon, one image per slot (PLAN R195); every member sees them.
 */
const SettingsPage = async ({ params }: Params) => {
  const { tenant: slug } = await params;
  const [overview, documents, brand] = await Promise.all([
    getTenant(slug),
    getDocuments(slug),
    getBrand(slug),
  ]);
  if (!overview || !documents || !brand) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const errors = writeErrors(t);
  const base = `/t/${tenant.slug}/settings`;
  return (
    <>
      <h1 className={styles.h1}>{t('admin.settings.title')}</h1>

      <FormSection id="review" title={t('admin.settings.review.title')}>
        {overview.platformAdmin ? (
          <LiveEditsForm
            tenant={tenant.slug}
            on={tenant.liveEditsNeedSecondApprover}
            text={{
              label: t('admin.settings.review.liveEdits'),
              hint: t('admin.settings.review.liveEditsHint'),
              save: t('admin.settings.review.save'),
              saved: t('admin.settings.saved'),
              errors,
            }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.settings.review.liveEdits')}</dt>
            <dd>
              {tenant.liveEditsNeedSecondApprover
                ? t('admin.settings.on')
                : t('admin.settings.off')}
            </dd>
            <dd className={styles.hint}>
              {t('admin.settings.review.liveEditsHint')} {t('admin.settings.review.platformOnly')}
            </dd>
          </dl>
        )}
      </FormSection>

      <FormSection id="colours" title={t('admin.settings.colours.title')}>
        {mayAct(overview, 'country_admin') ? (
          <ColourForm
            tenant={tenant.slug}
            accent={tenant.theme?.accent}
            platform={roles.bg.accent}
            locale={locale}
            text={{
              label: t('admin.settings.colours.label'),
              hint: t('admin.settings.colours.hint'),
              sample: siteName(tenant, locale).text,
              readable: template(t, 'admin.settings.colours.readable'),
              unreadable: template(t, 'admin.settings.colours.unreadable'),
              save: t('admin.settings.colours.save'),
              reset: t('admin.settings.colours.reset'),
              saved: t('admin.settings.saved'),
              resetDone: t('admin.settings.colours.resetDone'),
              errors,
            }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.settings.colours.label')}</dt>
            <dd>
              {tenant.theme?.accent
                ? t('admin.settings.colours.own', { colour: tenant.theme.accent })
                : t('admin.settings.colours.platform')}
            </dd>
            <dd className={styles.hint}>{t('admin.settings.colours.hint')}</dd>
          </dl>
        )}
      </FormSection>

      <FormSection
        id="logos"
        title={t('admin.settings.logos.title')}
        description={t('admin.settings.logos.intro')}
      >
        {brand.canEdit ? (
          <BrandImagesForm
            tenant={tenant.slug}
            slots={brand.slots}
            locale={locale}
            text={{
              slots: Object.fromEntries(
                brand.slots.map(({ slot }) => [
                  slot,
                  {
                    label: t(`admin.settings.logos.slots.${slotKey(slot)}.label`),
                    hint: t(`admin.settings.logos.slots.${slotKey(slot)}.hint`),
                  },
                ]),
              ),
              platformImage: template(t, 'admin.settings.logos.platformImage'),
              optional: t('admin.form.optional'),
              alt: template(t, 'admin.settings.logos.alt'),
              save: t('admin.settings.logos.save'),
              saved: t('admin.settings.logos.saved'),
              image: imageFieldText(t),
              errors,
            }}
          />
        ) : (
          <dl className={styles.facts}>
            {brand.slots.map(({ slot, file, asset }) => {
              const label = t(`admin.settings.logos.slots.${slotKey(slot)}.label`);
              return (
                <div key={slot}>
                  <dt>{label}</dt>
                  <dd>
                    {file ? (
                      <span className={styles.imageBox}>
                        {/* The API's members-only image: nothing for next/image to do. */}
                        {/* oxlint-disable-next-line next/no-img-element */}
                        <img
                          src={`/api/t/${tenant.slug}/images/${file.id}`}
                          alt={t('admin.settings.logos.alt', { slot: label })}
                        />
                      </span>
                    ) : asset ? (
                      t('admin.settings.logos.platformImage', { name: asset.name })
                    ) : (
                      t('admin.settings.logos.none')
                    )}
                  </dd>
                  <dd className={styles.hint}>
                    {t(`admin.settings.logos.slots.${slotKey(slot)}.hint`)}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </FormSection>

      <FormSection id="retention" title={t('admin.settings.retention.title')}>
        {mayAct(overview, 'country_admin') ? (
          <RetentionForm
            tenant={tenant.slug}
            days={tenant.reportRetentionDays}
            text={{
              label: t('admin.settings.retention.label'),
              hint: t('admin.settings.retention.hint'),
              save: t('admin.settings.retention.save'),
              saved: t('admin.settings.saved'),
              errors,
              problems: problemText(t),
            }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.settings.retention.label')}</dt>
            <dd>{t('admin.settings.retention.days', { days: tenant.reportRetentionDays })}</dd>
            <dd className={styles.hint}>{t('admin.settings.retention.hint')}</dd>
          </dl>
        )}
      </FormSection>

      <FormSection
        id="texts"
        title={t('admin.settings.texts.title')}
        description={t('admin.settings.texts.intro')}
      >
        <ul className={styles.cards}>
          {DOCUMENT_KINDS.map((kind) => {
            const versions = documents.documents.filter((d) => d.kind === kind);
            const published = versions.find((d) => d.publishedAt !== null);
            const draft = versions.find((d) => d.publishedAt === null);
            return (
              <li key={kind} className={styles.card}>
                <Link className={styles.cardLink} href={`${base}/texts/${kind}`}>
                  {t(`admin.settings.texts.kinds.${kind}`)}
                </Link>
                <span>
                  {published
                    ? t('admin.settings.texts.published', {
                        version: published.version,
                        date: new Date(published.publishedAt ?? ''),
                      })
                    : t('admin.settings.texts.notPublished')}
                </span>
                {draft ? (
                  <span className={styles.muted}>
                    {t('admin.settings.texts.draft', { version: draft.version })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </FormSection>
    </>
  );
};

export default SettingsPage;

/** A slot's messages' key: the slots the API lists are the public pages' (BRAND_SLOTS). */
const slotKey = (slot: string) =>
  slot as
    | 'operator_logo_on_accent'
    | 'operator_logo_on_canvas'
    | 'operator_logo_on_inverse'
    | 'operator_mark'
    | 'site_icon';
