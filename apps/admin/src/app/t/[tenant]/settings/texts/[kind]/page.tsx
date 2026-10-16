import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DOCUMENT_KINDS, type DocumentKind, getDocuments, getTenant } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { DocumentEditor } from '@/settings/DocumentEditor';
import { FormSection } from '@/ui/FormSection';
import { languageInSentence, languageName, localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { markdownText, problemText, template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; kind: string }> };

const isKind = (value: string): value is DocumentKind =>
  (DOCUMENT_KINDS as readonly string[]).includes(value);

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant: slug, kind } = await params;
  const overview = await getTenant(slug);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title:
      overview && isKind(kind)
        ? `${t(`admin.settings.texts.kinds.${kind}`)} · ${siteName(overview.tenant, locale).text}`
        : t('admin.notFound.title'),
  };
};

/**
 * One of the operator's texts (editorial workflow T2): the published version, the draft of the next one for country
 * admins to write, and the earlier versions, which never change. Shown as written: Markdown is rendered, sanitized, on
 * the public site.
 */
const DocumentPage = async ({ params }: Params) => {
  const { tenant: slug, kind } = await params;
  if (!isKind(kind)) {
    notFound();
  }
  const [overview, list] = await Promise.all([getTenant(slug), getDocuments(slug)]);
  if (!overview || !list) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const versions = list.documents.filter((d) => d.kind === kind);
  const published = versions.filter((d) => d.publishedAt !== null);
  const [latest] = published;
  const draft = versions.find((d) => d.publishedAt === null) ?? null;
  const nextVersion = Math.max(0, ...versions.map((d) => d.version)) + 1;
  const { tenant } = overview;
  return (
    <>
      <p>
        <Link className={styles.link} href={`/t/${tenant.slug}/settings`}>
          {t('admin.settings.title')}
        </Link>
      </p>
      <h1 className={styles.h1}>{t(`admin.settings.texts.kinds.${kind}`)}</h1>
      <p className={styles.text}>
        {latest
          ? t('admin.settings.texts.published', {
              version: latest.version,
              date: new Date(latest.publishedAt ?? ''),
            })
          : t('admin.settings.texts.notPublished')}
      </p>

      {list.canEdit ? (
        <FormSection
          id="draft"
          title={
            draft
              ? t('admin.settings.texts.draft', { version: draft.version })
              : t('admin.texts.newVersion', { version: nextVersion })
          }
          description={
            draft ? undefined : latest ? t('admin.texts.copyIntro') : t('admin.texts.firstIntro')
          }
        >
          <DocumentEditor
            tenant={tenant.slug}
            kind={kind}
            draft={draft ? { id: draft.id, version: draft.version, body: draft.body } : null}
            copyOf={latest?.body ?? {}}
            nextVersion={nextVersion}
            locales={localeOptions(tenant, locale)}
            text={{
              body: t('admin.texts.body'),
              bodyHint: t('admin.texts.bodyHint'),
              needed: t('admin.localized.needed'),
              saveDraft: t('admin.texts.saveDraft'),
              publish: t('admin.texts.publish'),
              publishTitle: t('admin.texts.publishTitle'),
              publishBody: t('admin.texts.publishBody'),
              deleteDraft: t('admin.texts.deleteDraft'),
              deleteTitle: t('admin.texts.deleteTitle'),
              deleteBody: t('admin.texts.deleteBody'),
              confirmPublish: t('admin.texts.publish'),
              confirmDelete: t('admin.texts.deleteDraft'),
              cancel: t('admin.members.cancel'),
              saved: t('admin.texts.saved'),
              published: template(t, 'admin.texts.published'),
              deleted: t('admin.texts.deleted'),
              errors: {
                ...writeErrors(t),
                needsDefaultLanguage: t('admin.texts.needsLanguage', {
                  language: languageInSentence(tenant.defaultLocale, locale),
                }),
              },
              markdown: markdownText(t),
              problems: problemText(t),
            }}
          />
        </FormSection>
      ) : (
        <p className={styles.text}>{t('admin.texts.readOnly')}</p>
      )}

      <h2 className={styles.h2}>{t('admin.texts.history')}</h2>
      {published.length === 0 ? (
        <p className={styles.text}>{t('admin.settings.texts.notPublished')}</p>
      ) : (
        <ul className={styles.versions}>
          {published.map((version) => (
            <li key={version.id}>
              <details className={styles.details}>
                <summary className={styles.summary}>
                  {t('admin.settings.texts.published', {
                    version: version.version,
                    date: new Date(version.publishedAt ?? ''),
                  })}
                </summary>
                {Object.entries(version.body).map(([code, body]) => (
                  <section key={code} className={styles.versionText}>
                    <h3 className={styles.h3}>{languageName(code, locale)}</h3>
                    <div className={styles.prose} lang={code}>
                      {body}
                    </div>
                  </section>
                ))}
              </details>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default DocumentPage;
