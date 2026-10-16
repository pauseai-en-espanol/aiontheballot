import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getParties } from '@/elections/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { ActionButton } from '@/sources/ActionButton';
import { getSource } from '@/sources/data';
import { SourceForm } from '@/sources/SourceForm';
import { sourceFormText, sourceKinds } from '@/sources/text';
import { UploadForm } from '@/sources/UploadForm';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { EditToggle } from '@/ui/EditToggle';
import { FormSection } from '@/ui/FormSection';
import { Lang } from '@/ui/Lang';
import { languageName } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { fileFieldText, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string; id: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant, election, id } = await params;
  const [t, found] = await Promise.all([
    getLocale().then(getTranslator),
    getSource(tenant, election, id),
  ]);
  return {
    title: `${found?.source.title ?? t('admin.notFound.title')} · ${t('admin.sources.title')}`,
  };
};

/**
 * One source (editorial workflow §7): its fields, which change until its copy is stored (S1.2); its copy, uploaded
 * here (S2.2) and downloaded, never opened on the admin's origin (S6); its extraction (S3) and the text quotes are
 * matched against, members only (S6.2); and its deletion while it has no copy, so nothing cites it (S5.2).
 */
const SourcePage = async ({ params }: Params) => {
  const { tenant: slug, election, id } = await params;
  const [overview, found, structure] = await Promise.all([
    getTenant(slug),
    getSource(slug, election, id),
    getParties(slug, election),
  ]);
  if (!overview || !found || !structure) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const { source, units, canEdit } = found;
  const base = `/t/${tenant.slug}/e/${election}/sources`;
  const api = `/api/t/${tenant.slug}/e/${election}/sources/${source.id}`;
  const name = (localized: Record<string, string>, fallback: string) =>
    inLanguage(localized, locale, tenant.defaultLocale) ?? { text: fallback, lang: locale };
  const party = structure.parties.find((candidate) => candidate.id === source.partyId);
  const lang = source.language ?? undefined;
  const size = (bytes: number) =>
    new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: bytes < 1_000_000 ? 'kilobyte' : 'megabyte',
      maximumFractionDigits: 1,
    }).format(bytes < 1_000_000 ? bytes / 1_000 : bytes / 1_000_000);
  const state = source.copy
    ? t(`admin.sources.states.${source.extractionStatus}`)
    : t('admin.sources.states.noCopy');
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.sources.back')}
        </Link>
      </p>
      <h2 className={styles.h2} lang={lang}>
        {source.title}
      </h2>
      <section aria-labelledby="source-details" className={styles.section}>
        <h3 id="source-details" className={styles.h3}>
          {t('admin.sources.details')}
        </h3>
        {/* One view of its details: the facts, and while it has no copy, "Edit" to change them (PLAN R194). */}
        {canEdit && !source.copy ? (
          <EditToggle
            view={
              <dl className={styles.facts}>
                <dt>{t('admin.sources.fields.kind')}</dt>
                <dd>{sourceKinds(t)[source.kind]}</dd>
                <dt>{t('admin.sources.fields.party')}</dt>
                <dd>
                  {party ? (
                    <Lang value={name(party.name, party.slug)} page={locale} />
                  ) : (
                    t('admin.sources.neutral')
                  )}
                  {source.isProgramme ? <> ({t('admin.sources.programmeTag')})</> : null}
                </dd>
                <dt>{t('admin.sources.fields.language')}</dt>
                <dd>{source.language ? languageName(source.language, locale) : '—'}</dd>
                <dt>{t('admin.sources.fields.url')}</dt>
                <dd>
                  {source.url ? (
                    // A party's address: opened elsewhere, with nothing of ours passed on.
                    <a
                      className={styles.link}
                      href={source.url}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                    >
                      {source.url}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt>{t('admin.sources.columns.state')}</dt>
                <dd>
                  {state} ·{' '}
                  {source.citable ? t('admin.sources.citable') : t('admin.sources.notCitable')}
                </dd>
                <dt>{t('admin.sources.columns.citations')}</dt>
                <dd>{t('admin.sources.citations', { count: source.citations })}</dd>
              </dl>
            }
            form={
              <SourceForm
                path={api}
                method="PUT"
                values={source}
                parties={structure.parties
                  .filter((candidate) => !candidate.retired || candidate.id === source.partyId)
                  .map((candidate) => {
                    const shown = name(candidate.name, candidate.slug);
                    return { id: candidate.id, name: shown.text, lang: shown.lang };
                  })}
                siteLanguages={[
                  tenant.defaultLocale,
                  ...tenant.enabledLocales.filter((code) => code !== tenant.defaultLocale),
                ]}
                locale={locale}
                text={sourceFormText(t)}
              />
            }
            text={{ edit: t('admin.form.edit'), stop: t('admin.form.stopEditing') }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.sources.fields.kind')}</dt>
            <dd>{sourceKinds(t)[source.kind]}</dd>
            <dt>{t('admin.sources.fields.party')}</dt>
            <dd>
              {party ? (
                <Lang value={name(party.name, party.slug)} page={locale} />
              ) : (
                t('admin.sources.neutral')
              )}
              {source.isProgramme ? <> ({t('admin.sources.programmeTag')})</> : null}
            </dd>
            <dt>{t('admin.sources.fields.language')}</dt>
            <dd>{source.language ? languageName(source.language, locale) : '—'}</dd>
            <dt>{t('admin.sources.fields.url')}</dt>
            <dd>
              {source.url ? (
                // A party's address: opened elsewhere, with nothing of ours passed on.
                <a
                  className={styles.link}
                  href={source.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                >
                  {source.url}
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt>{t('admin.sources.columns.state')}</dt>
            <dd>
              {state} ·{' '}
              {source.citable ? t('admin.sources.citable') : t('admin.sources.notCitable')}
            </dd>
            <dt>{t('admin.sources.columns.citations')}</dt>
            <dd>{t('admin.sources.citations', { count: source.citations })}</dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="source-copy" className={styles.section}>
        <h3 id="source-copy" className={styles.h3}>
          {t('admin.sources.copy.title')}
        </h3>
        {source.copy ? (
          <>
            <p className={styles.text}>
              {t('admin.sources.copy.storedShort', {
                date: new Date(source.copy.retrievedAt),
                size: size(source.copy.byteSize),
              })}
            </p>
            {/* What only the platform needs: out of the way (admin forms §2, sources). */}
            <details className={styles.details}>
              <summary className={styles.summary}>{t('admin.sources.technical')}</summary>
              <p className={styles.hint}>
                {t('admin.sources.copy.type', { type: source.copy.contentType })}
              </p>
              <p className={styles.hint}>
                {t('admin.sources.copy.hash', { hash: source.copy.sha256 })}
              </p>
            </details>
            <p>
              {/* A download, never shown here: the API sends it as an attachment, sandboxed (S6). */}
              <a className={styles.link} href={`${api}/copy`} download>
                {t('admin.sources.copy.download')}
              </a>
            </p>
          </>
        ) : (
          <>
            <p className={styles.text}>{t('admin.sources.copy.none')}</p>
            {/* From its URL, by the fetcher (S2.1; ADR-0007): stored as this member's upload. */}
            {canEdit && found.uploads && found.fetching && source.url ? (
              <>
                <p className={styles.hint}>{t('admin.sources.copy.fetchHint')}</p>
                <ActionButton
                  path={`${api}/fetch`}
                  text={{
                    button: t('admin.sources.copy.fetch'),
                    done: t('admin.sources.copy.fetched'),
                    errors: writeErrors(t),
                  }}
                />
              </>
            ) : null}
            {!canEdit ? null : found.uploads ? (
              <UploadForm
                path={`${api}/copy`}
                locale={locale}
                text={{
                  file: t('admin.sources.copy.file'),
                  fileHint: t('admin.sources.copy.fileHint'),
                  contributor: t('admin.sources.copy.contributor'),
                  final: t('admin.sources.copy.final'),
                  upload: t('admin.sources.copy.upload'),
                  uploaded: t('admin.sources.copy.uploaded'),
                  errors: writeErrors(t),
                  fileField: fileFieldText(t),
                }}
              />
            ) : (
              <p className={styles.notice}>{t('admin.sources.copy.unavailable')}</p>
            )}
          </>
        )}
      </section>
      {/* A snapshot of its URL (S4; ADR-0007 §4): missing, it is a warning, never a block (W12). */}
      {source.url ? (
        <section aria-labelledby="source-archive" className={styles.section}>
          <h3 id="source-archive" className={styles.h3}>
            {t('admin.sources.archive.title')}
          </h3>
          {source.archiveUrl ? (
            <p>
              <a
                className={styles.link}
                href={source.archiveUrl}
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                {t('admin.sources.archive.open')}
              </a>
            </p>
          ) : source.archiveRequested ? (
            <p className={styles.text}>{t('admin.sources.archive.requested')}</p>
          ) : !source.copy && found.archiving ? (
            // Taken with the copy, once the URL can't change; the archive is public.
            <p className={styles.text}>{t('admin.sources.archive.withCopy')}</p>
          ) : (
            <>
              <p className={styles.notice}>{t('admin.sources.archive.none')}</p>
              {canEdit && found.archiving ? (
                <ActionButton
                  path={`${api}/archive`}
                  text={{
                    button: t('admin.sources.archive.ask'),
                    done: t('admin.sources.archive.asked'),
                    errors: writeErrors(t),
                  }}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {source.copy ? (
        <section aria-labelledby="source-text" className={styles.section}>
          <h3 id="source-text" className={styles.h3}>
            {t('admin.sources.extraction.title')}
          </h3>
          {source.extractionStatus === 'pending' ? (
            <>
              <p className={styles.text}>
                {found.extraction
                  ? t('admin.sources.extraction.pending')
                  : t('admin.sources.extraction.unavailable')}
              </p>
              {found.extraction && canEdit && source.extractionRequested ? (
                <ActionButton
                  path={`${api}/extract`}
                  text={{
                    button: t('admin.sources.extraction.again'),
                    done: t('admin.sources.extraction.asked'),
                    errors: writeErrors(t),
                  }}
                />
              ) : null}
            </>
          ) : source.extractionStatus === 'failed' ? (
            <p className={styles.notice}>{t('admin.sources.extraction.failed')}</p>
          ) : source.extractionStatus === 'not_applicable' ? (
            <p className={styles.text}>{t('admin.sources.extraction.notApplicable')}</p>
          ) : (
            <>
              <p className={styles.text}>
                {t('admin.sources.extraction.intro')}{' '}
                {t('admin.sources.extraction.units', { count: units.length })}
              </p>
              <ol className={styles.versions} lang={lang}>
                {units.map((unit) => (
                  <li key={unit.index}>
                    <details className={styles.details}>
                      <summary className={styles.summary}>{unit.label}</summary>
                      <p className={`${styles.prose} ${styles.versionText}`}>{unit.body}</p>
                    </details>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      ) : null}
      {/* Replaced by a newer version (PLAN D14): once its copy is stored, the source can't change or go, so it is marked. */}
      {source.replacedAt ? (
        <p className={styles.notice}>
          {t('admin.sources.replacedOn', { date: new Date(source.replacedAt) })}
        </p>
      ) : canEdit && source.copy ? (
        <section aria-labelledby="source-replace" className={styles.section}>
          <h3 id="source-replace" className={styles.h3}>
            {t('admin.sources.replaceHeading')}
          </h3>
          <p className={styles.text}>{t('admin.sources.replaceIntro')}</p>
          {/* The section goes once the source is marked, so the page's announcer says it's done. */}
          <ConfirmButton
            method="POST"
            path={`${api}/replaced`}
            removes
            text={{
              button: t('admin.sources.replace'),
              title: t('admin.sources.replaceTitle'),
              body: t('admin.sources.replaceBody'),
              confirm: t('admin.sources.replace'),
              cancel: t('admin.members.cancel'),
              done: t('admin.sources.replaceDone'),
              errors: writeErrors(t),
            }}
          />
        </section>
      ) : null}
      {/* Once a copy is stored, its text and its job are kept for good (data model §3.4), so the source stays. */}
      {canEdit && !source.copy && source.citations === 0 ? (
        // Last on the page, apart (admin forms §1.4).
        <FormSection id="source-delete" title={t('admin.sources.delete')} level={3} danger>
          <ConfirmButton
            method="DELETE"
            path={api}
            then={base}
            text={{
              button: t('admin.sources.delete'),
              title: t('admin.sources.deleteTitle'),
              body: t('admin.sources.deleteBody'),
              confirm: t('admin.sources.delete'),
              cancel: t('admin.members.cancel'),
              done: t('admin.sources.deleted'),
              errors: { ...writeErrors(t), linked: t('admin.sources.deleteCited') },
            }}
          />
        </FormSection>
      ) : null}
    </>
  );
};

export default SourcePage;
