import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { AnnounceForm } from '@/elections/AnnounceForm';
import { getChecklist, getElection } from '@/elections/data';
import { ElectionForm } from '@/elections/ElectionForm';
import { electionConstraints, electionFormText } from '@/elections/forms';
import { FreezeForm } from '@/elections/FreezeForm';
import { GoLivePanel } from '@/elections/GoLivePanel';
import { ReviewSettingForm } from '@/elections/ReviewSettingForm';
import { goLiveNeeds, goLiveWarnings } from '@/elections/status-text';
import { electionDate, electionTypes, freezeLine, freezeOpen } from '@/elections/text';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { languageName, localeOptions } from '@/ui/locales';
import * as styles from '@/ui/styles';
import { writeErrors } from '@/ui/text';

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
 * An election's overview (editorial workflow §13.6): its fields, which editors change while it is a draft (E1.3), its
 * announcement (country admins, R51), its review setting (platform admins, P1, with a confirmation to turn it off), and
 * going live with its checklist (E5), the freeze window (E6), archiving (E7), and deleting a draft (E8).
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
  const checklist =
    election.status === 'draft' && canAdminister
      ? await getChecklist(slug, electionSlug)
      : undefined;
  const { tenant } = overview;
  const draft = election.status === 'draft';
  const errors = writeErrors(t);
  const path = `/api/t/${tenant.slug}/e/${election.slug}`;
  const name = inLanguage(election.name, locale, tenant.defaultLocale);
  return (
    <>
      <h2 className={styles.h2}>{t('admin.election.details')}</h2>
      {draft && canEdit ? (
        <ElectionForm
          tenant={tenant.slug}
          countryCode={tenant.countryCode}
          locales={localeOptions(tenant, locale)}
          election={{
            slug: election.slug,
            type: election.type,
            territoryCode: election.territoryCode,
            name: election.name,
            date: election.date,
          }}
          text={{
            ...electionFormText(t, t('admin.election.saveDetails')),
            constraints: electionConstraints(t),
          }}
        />
      ) : (
        <dl className={styles.facts}>
          <dt>{t('admin.elections.form.name')}</dt>
          <dd lang={name?.lang}>{name?.text}</dd>
          <dt>{t('admin.elections.form.slug')}</dt>
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

      <h2 className={styles.h2}>{t('admin.election.announcement')}</h2>
      {draft && canAdminister ? (
        <AnnounceForm
          tenant={tenant.slug}
          election={election.slug}
          on={election.announced}
          text={{
            label: t('admin.election.announced'),
            hint: t('admin.election.announcedHint'),
            save: t('admin.election.saveAnnouncement'),
            saved: t('admin.settings.saved'),
            errors,
          }}
        />
      ) : (
        <p className={styles.text}>
          {election.announced ? t('admin.election.isAnnounced') : t('admin.election.notAnnounced')}
        </p>
      )}

      <h2 className={styles.h2}>{t('admin.election.review')}</h2>
      {platformAdmin && election.status !== 'archived' ? (
        <ReviewSettingForm
          tenant={tenant.slug}
          election={election.slug}
          on={election.requireSecondReviewer}
          text={{
            label: t('admin.election.fourEyes'),
            hint: t('admin.election.fourEyesHint'),
            save: t('admin.settings.review.save'),
            saved: t('admin.settings.saved'),
            confirmTitle: t('admin.election.fourEyesOffTitle'),
            confirmBody: t('admin.election.fourEyesOffBody'),
            confirm: t('admin.election.fourEyesOff'),
            cancel: t('admin.members.cancel'),
            errors,
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

      {draft && canAdminister && checklist ? (
        <>
          <h2 className={styles.h2}>{t('admin.status.goLive')}</h2>
          <p className={styles.text}>{t('admin.status.goLiveIntro')}</p>
          <GoLivePanel
            path={path}
            slug={election.slug}
            needs={goLiveNeeds(t, checklist, languageName(tenant.defaultLocale, locale))}
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
              typeSlug: t('admin.status.typeSlug', { slug: election.slug }),
              confirm: t('admin.status.confirm'),
              cancel: t('admin.members.cancel'),
              wentLive: t('admin.status.wentLive'),
              slugMismatch: t('admin.status.slugMismatch'),
              errors,
            }}
          />
        </>
      ) : null}

      {election.status === 'live' ? (
        <>
          <h2 className={styles.h2}>{t('admin.status.freeze')}</h2>
          <p className={styles.text}>{t('admin.status.freezeIntro')}</p>
          {canAdminister ? (
            <FreezeForm
              key={`${election.frozenFrom}/${election.frozenUntil}`}
              path={path}
              from={election.frozenFrom}
              until={election.frozenUntil}
              text={{
                from: t('admin.status.frozenFrom'),
                until: t('admin.status.frozenUntil'),
                untilHint: t('admin.status.frozenUntilHint'),
                save: t('admin.status.saveFreeze'),
                clear: t('admin.status.clearFreeze'),
                saved: t('admin.status.freezeSaved'),
                cleared: t('admin.status.freezeCleared'),
                endBeforeStart: t('admin.status.endBeforeStart'),
                errors,
              }}
            />
          ) : (
            <p className={styles.text}>{freezeLine(t, election) ?? t('admin.status.noFreeze')}</p>
          )}
          {canAdminister && election.frozenFrom === null ? (
            <p className={styles.hint}>{t('admin.status.noFreeze')}</p>
          ) : null}
          {canAdminister ? (
            <>
              <h2 className={styles.h2}>{t('admin.status.archive')}</h2>
              <p className={styles.text}>{t('admin.status.archiveIntro')}</p>
              {freezeOpen(election) ? (
                <p className={styles.notice}>{t('admin.status.archiveFrozen')}</p>
              ) : (
                <ConfirmButton
                  method="PATCH"
                  path={path}
                  body={{ status: 'archived' }}
                  removes
                  text={{
                    button: t('admin.status.archiveConfirm'),
                    title: t('admin.status.archiveTitle'),
                    body: t('admin.status.archiveBody'),
                    confirm: t('admin.status.archiveConfirm'),
                    cancel: t('admin.members.cancel'),
                    done: t('admin.status.archived'),
                    errors,
                  }}
                />
              )}
            </>
          ) : null}
        </>
      ) : null}

      {draft && canAdminister ? (
        <>
          <h2 className={styles.h2}>{t('admin.election.delete')}</h2>
          <p className={styles.text}>{t('admin.election.deleteIntro')}</p>
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
              done: '',
              errors: { ...errors, linked: t('admin.election.deleteLinked') },
            }}
          />
        </>
      ) : null}
    </>
  );
};

export default ElectionPage;
