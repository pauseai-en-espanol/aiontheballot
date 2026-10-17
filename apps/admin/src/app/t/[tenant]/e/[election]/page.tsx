import type { Metadata } from 'next';

import { sitePath } from '@aiontheballot/domain/site-paths';
import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { AnnounceForm } from '@/elections/AnnounceForm';
import { editedDirectly, getChecklist, getElection, getRechecks } from '@/elections/data';
import { ElectionForm } from '@/elections/ElectionForm';
import { electionConstraints, electionFormText } from '@/elections/forms';
import { FreezeForm } from '@/elections/FreezeForm';
import { GoLivePanel } from '@/elections/GoLivePanel';
import { RecheckList } from '@/elections/RecheckList';
import { ReviewSettingForm } from '@/elections/ReviewSettingForm';
import { goLiveNeeds, goLiveWarnings } from '@/elections/status-text';
import { electionDate, electionTypes, freezeLine, freezeOpen } from '@/elections/text';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { getSources } from '@/sources/data';
import { territoriesOf } from '@/territories';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { FormSection } from '@/ui/FormSection';
import { languageInSentence, localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { problemText, template, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; election: string }> };

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const { tenant, election } = await params;
  const [overview, found] = await Promise.all([getTenant(tenant), getElection(tenant, election)]);
  const locale = await getLocale();
  const t = getTranslator(locale);
  if (!overview || !found) {
    return { title: t('admin.notFound.title') };
  }
  const name =
    inLanguage(found.election.name, locale, overview.tenant.defaultLocale)?.text ?? election;
  return { title: `${name} · ${t('admin.election.overview')}` };
};

/**
 * An election's overview (editorial workflow §13.6): its fields, which editors change while it is a draft or in preview
 * (E1.3, PLAN R181), its announcement (country admins, R51), its review setting (platform admins, P1, with a
 * confirmation to turn it off), opening its preview and then going live, each with its checklist (E5, PLAN R181), the
 * freeze window (E6), archiving (E7), and deleting a draft (E8).
 */
const ElectionPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
  const [overview, found] = await Promise.all([getTenant(slug), getElection(slug, electionSlug)]);
  if (!overview || !found) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { election, canEdit, canAdminister, platformAdmin } = found;
  const editable = editedDirectly(election.status);
  const checklist = editable && canAdminister ? await getChecklist(slug, electionSlug) : undefined;
  // "Not mentioned" ratings to check against a newer document (D20, PLAN R187); a draft has none published.
  const rechecks = election.status === 'draft' ? undefined : await getRechecks(slug, electionSlug);
  const { tenant } = overview;
  const draft = election.status === 'draft';
  const errors = writeErrors(t);
  const path = `/api/t/${tenant.slug}/e/${election.slug}`;
  const base = `/t/${tenant.slug}/e/${election.slug}`;
  const name = inLanguage(election.name, locale, tenant.defaultLocale);
  const language = languageInSentence(tenant.defaultLocale, locale);
  // A draft is deleted only once nothing hangs from it (E8): said beside a button that can't fail, rather than offered.
  const deletable =
    draft && canAdminister && checklist
      ? !checklist.needs.methodology &&
        checklist.warnings.noParties &&
        checklist.warnings.noCriteria &&
        (await getSources(slug, electionSlug))?.sources.length === 0
      : false;
  const switchWords = {
    on: t('admin.settings.on'),
    off: t('admin.settings.off'),
    saved: t('admin.settings.saved'),
    errors,
  };
  return (
    <>
      {/* First, where the election stands and what comes next, with what that needs (admin forms §2, PLAN R193). */}
      <section aria-labelledby="status" className={styles.statusCard}>
        <h2 id="status" className={styles.h2}>
          {t('admin.election.statusTitle')}
        </h2>
        <p className={styles.text}>
          <strong>{t(`admin.elections.statuses.${election.status}`)}.</strong>{' '}
          {t(`admin.election.statusLines.${election.status}`)}
        </p>
        {election.status === 'preview' ? (
          <p className={styles.text}>
            <a className={styles.link} href={`/t/${tenant.slug}/preview/${election.slug}`}>
              {t('admin.election.seePreview')}
            </a>
          </p>
        ) : null}
        {canAdminister && election.status !== 'archived' ? (
          <p className={styles.text}>{t(`admin.election.next.${election.status}`)}</p>
        ) : null}
        {draft && canAdminister && checklist ? (
          <>
            <p className={styles.hint}>{t('admin.status.openPreviewIntro')}</p>
            <GoLivePanel
              path={path}
              slug={election.slug}
              to="preview"
              needs={goLiveNeeds(t, checklist, language, base)}
              warnings={goLiveWarnings(t, checklist)}
              text={{
                needsTitle: t('admin.status.previewNeedsTitle'),
                warningsTitle: t('admin.status.warningsTitle'),
                done: t('admin.status.done'),
                missing: t('admin.status.missing'),
                button: t('admin.status.openPreview'),
                notReady: t('admin.status.previewNotReady'),
                confirmTitle: t('admin.status.previewConfirmTitle'),
                confirmBody: t('admin.status.previewConfirmBody'),
                confirm: t('admin.status.openPreview'),
                cancel: t('admin.members.cancel'),
                wentLive: t('admin.status.previewOpened'),
                errors,
              }}
            />
          </>
        ) : null}
        {election.status === 'preview' && canAdminister && checklist ? (
          <>
            <p className={styles.hint}>{t('admin.status.goLiveIntro')}</p>
            <GoLivePanel
              path={path}
              slug={election.slug}
              needs={goLiveNeeds(t, checklist, language, base)}
              warnings={goLiveWarnings(t, checklist)}
              text={{
                needsTitle: t('admin.status.needsTitle'),
                warningsTitle: t('admin.status.warningsTitle'),
                done: t('admin.status.done'),
                missing: t('admin.status.missing'),
                button: t('admin.status.goLive'),
                notReady: t('admin.status.notReady'),
                confirmTitle: t('admin.status.confirmTitle'),
                confirmBody: t('admin.status.confirmBody'),
                typeSlug: template(t, 'admin.status.typeSlug'),
                confirm: t('admin.status.confirm'),
                cancel: t('admin.members.cancel'),
                wentLive: t('admin.status.wentLive'),
                slugMismatch: t('admin.status.slugMismatch'),
                errors,
              }}
            />
          </>
        ) : null}
      </section>

      {rechecks ? (
        <RecheckList
          rechecks={rechecks.rechecks}
          base={base}
          locale={locale}
          defaultLocale={tenant.defaultLocale}
          level={2}
        />
      ) : null}

      <FormSection id="details" title={t('admin.election.details')}>
        {editable && canEdit ? (
          <ElectionForm
            tenant={tenant.slug}
            countryCode={tenant.countryCode}
            locales={localeOptions(tenant, locale)}
            territories={territoriesOf(tenant.countryCode)}
            locale={locale}
            election={{
              slug: election.slug,
              type: election.type,
              territoryCode: election.territoryCode,
              name: election.name,
              date: election.date,
            }}
            slugAddress={sitePath(tenant.defaultLocale, { page: 'election', election: '{slug}' })}
            text={{
              ...electionFormText(t, t('admin.election.saveDetails'), true),
              constraints: electionConstraints(t),
            }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.elections.form.name')}</dt>
            <dd lang={name?.lang}>{name?.text}</dd>
            <dt>{t('admin.form.slug.label')}</dt>
            <dd>{election.slug}</dd>
            <dt>{t('admin.elections.form.type')}</dt>
            <dd>
              {electionTypes(t)[election.type]}
              {election.territoryCode ? ` (${election.territoryCode})` : null}
            </dd>
            <dt>{t('admin.elections.form.date')}</dt>
            <dd>{electionDate(t, election.date)}</dd>
          </dl>
        )}
      </FormSection>

      {/* Settings save as they are switched; turning four-eyes off still asks first. */}
      <FormSection id="settings" title={t('admin.election.settingsTitle')}>
        {editable && canAdminister ? (
          <AnnounceForm
            tenant={tenant.slug}
            election={election.slug}
            on={election.announced}
            text={{
              label: t('admin.election.announced'),
              hint: t('admin.election.announcedHint'),
              needsName: t('admin.election.announceNeedsName'),
              ...switchWords,
            }}
          />
        ) : (
          <p className={styles.text}>
            {election.announced
              ? t('admin.election.isAnnounced')
              : t('admin.election.notAnnounced')}
          </p>
        )}
        {platformAdmin && election.status !== 'archived' ? (
          <ReviewSettingForm
            tenant={tenant.slug}
            election={election.slug}
            on={election.requireSecondReviewer}
            text={{
              label: t('admin.election.fourEyes'),
              hint: t('admin.election.fourEyesHint'),
              confirmTitle: t('admin.election.fourEyesOffTitle'),
              confirmBody: t('admin.election.fourEyesOffBody'),
              confirm: t('admin.election.fourEyesOff'),
              cancel: t('admin.members.cancel'),
              ...switchWords,
            }}
          />
        ) : (
          <dl className={styles.facts}>
            <dt>{t('admin.election.fourEyes')}</dt>
            <dd>
              {election.requireSecondReviewer ? t('admin.settings.on') : t('admin.settings.off')}
            </dd>
            <dd className={styles.hint}>
              {t('admin.election.fourEyesHint')} {t('admin.settings.review.platformOnly')}
            </dd>
          </dl>
        )}
      </FormSection>

      {election.status === 'live' && !canAdminister ? (
        <FormSection
          id="freeze"
          title={t('admin.status.freeze')}
          description={t('admin.status.freezeIntro')}
        >
          <p className={styles.text}>{freezeLine(t, election) ?? t('admin.status.noFreeze')}</p>
        </FormSection>
      ) : null}

      {election.status === 'live' && canAdminister ? (
        <FormSection
          id="freeze"
          title={t('admin.status.freeze')}
          description={t('admin.status.freezeIntro')}
        >
          {election.frozenFrom === null ? (
            // Behind its own button while there is none (admin forms §2).
            <>
              <p className={styles.hint}>{t('admin.status.noFreeze')}</p>
              <details>
                <summary className={`${styles.summary} ${styles.secondaryButton}`}>
                  {t('admin.status.scheduleFreeze')}
                </summary>
                <FreezeForm
                  key={`${election.frozenFrom}/${election.frozenUntil}`}
                  path={path}
                  from={election.frozenFrom}
                  until={election.frozenUntil}
                  text={freezeText(t)}
                />
              </details>
            </>
          ) : (
            <FreezeForm
              key={`${election.frozenFrom}/${election.frozenUntil}`}
              path={path}
              from={election.frozenFrom}
              until={election.frozenUntil}
              text={freezeText(t)}
            />
          )}
        </FormSection>
      ) : null}

      {election.status === 'live' && canAdminister ? (
        <FormSection
          id="archive"
          title={t('admin.status.archive')}
          description={t('admin.status.archiveIntro')}
          danger
        >
          {freezeOpen(election) ? (
            <p className={styles.notice}>{t('admin.status.archiveFrozen')}</p>
          ) : (
            // Can't be undone: the address name typed first, as for going live (PLAN R193).
            <GoLivePanel
              path={path}
              slug={election.slug}
              to="archived"
              needs={[]}
              warnings={[]}
              text={{
                needsTitle: '',
                warningsTitle: '',
                done: t('admin.status.done'),
                missing: t('admin.status.missing'),
                button: t('admin.status.archiveConfirm'),
                notReady: '',
                confirmTitle: t('admin.status.archiveTitle'),
                confirmBody: t('admin.status.archiveBody'),
                typeSlug: template(t, 'admin.status.typeToArchive'),
                confirm: t('admin.status.archiveConfirm'),
                cancel: t('admin.members.cancel'),
                wentLive: t('admin.status.archived'),
                slugMismatch: t('admin.status.slugMismatch'),
                errors,
              }}
            />
          )}
        </FormSection>
      ) : null}

      {draft && canAdminister ? (
        <FormSection
          id="delete"
          title={t('admin.election.delete')}
          description={t('admin.election.deleteIntro')}
          danger
        >
          {deletable ? (
            <ConfirmButton
              method="DELETE"
              path={path}
              then={`/t/${tenant.slug}/elections`}
              text={{
                button: t('admin.election.delete'),
                title: t('admin.election.deleteTitle'),
                body: t('admin.election.deleteBody'),
                confirm: t('admin.election.delete'),
                cancel: t('admin.members.cancel'),
                done: t('admin.election.deleted'),
                errors: { ...errors, linked: t('admin.election.deleteLinked') },
              }}
            />
          ) : (
            <>
              <div>
                <button
                  className={styles.button}
                  type="button"
                  disabled
                  aria-describedby="delete-why"
                >
                  {t('admin.election.delete')}
                </button>
              </div>
              <p id="delete-why" className={styles.hint}>
                {t('admin.election.deleteLinked')}
              </p>
            </>
          )}
        </FormSection>
      ) : null}

      {platformAdmin ? (
        <FormSection
          id="purge"
          title={t('admin.election.purge')}
          description={t('admin.election.purgeIntro')}
          danger
        >
          {/* Whatever its status, with everything in it (PLAN R212): the address name typed first, as for archiving. */}
          <ConfirmButton
            method="POST"
            path={`${path}/purge`}
            then={`/t/${tenant.slug}/elections`}
            typeToConfirm={{
              slug: election.slug,
              label: template(t, 'admin.election.typeToPurge'),
              mismatch: t('admin.status.slugMismatch'),
            }}
            text={{
              button: t('admin.election.purge'),
              title: t('admin.election.purgeTitle'),
              body: t('admin.election.purgeBody'),
              confirm: t('admin.election.purge'),
              cancel: t('admin.members.cancel'),
              done: t('admin.election.purged'),
              errors,
            }}
          />
        </FormSection>
      ) : null}
    </>
  );
};

/** The freeze form's words. */
const freezeText = (t: ReturnType<typeof getTranslator>) => ({
  from: t('admin.status.frozenFrom'),
  until: t('admin.status.frozenUntil'),
  untilHint: t('admin.status.frozenUntilHint'),
  localTime: template(t, 'admin.status.localTime'),
  optional: t('admin.form.optional'),
  save: t('admin.status.saveFreeze'),
  clear: t('admin.status.clearFreeze'),
  saved: t('admin.status.freezeSaved'),
  cleared: t('admin.status.freezeCleared'),
  endBeforeStart: t('admin.status.endBeforeStart'),
  errors: writeErrors(t),
  problems: problemText(t),
});

export default ElectionPage;
