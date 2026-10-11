import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DOCUMENT_KINDS, getDocuments, getTenant, mayAct } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { LiveEditsForm, RetentionForm } from '@/settings/SettingsForms';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

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
 * A tenant's settings (editorial workflow §5, P1): every member sees them (P1.3); country admins change the report
 * retention and write the policy texts, and only platform admins whether live edits need a second approver. Theme
 * colours wait for the public site's names for them (T1.2), and logos for uploads.
 */
const SettingsPage = async ({ params }: Params) => {
  const { tenant: slug } = await params;
  const [overview, documents] = await Promise.all([getTenant(slug), getDocuments(slug)]);
  if (!overview || !documents) {
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

      <h2 className={styles.h2}>{t('admin.settings.review.title')}</h2>
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
            {tenant.liveEditsNeedSecondApprover ? t('admin.settings.on') : t('admin.settings.off')}
          </dd>
          <dd className={styles.hint}>
            {t('admin.settings.review.liveEditsHint')} {t('admin.settings.review.platformOnly')}
          </dd>
        </dl>
      )}

      <h2 className={styles.h2}>{t('admin.settings.retention.title')}</h2>
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
          }}
        />
      ) : (
        <dl className={styles.facts}>
          <dt>{t('admin.settings.retention.label')}</dt>
          <dd>{t('admin.settings.retention.days', { days: tenant.reportRetentionDays })}</dd>
          <dd className={styles.hint}>{t('admin.settings.retention.hint')}</dd>
        </dl>
      )}

      <h2 className={styles.h2}>{t('admin.settings.texts.title')}</h2>
      <p className={styles.text}>{t('admin.settings.texts.intro')}</p>
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
    </>
  );
};

export default SettingsPage;
