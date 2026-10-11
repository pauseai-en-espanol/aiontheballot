import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getElection, getMethodology, SOURCE_KINDS, type SourceKind } from '@/elections/data';
import { MethodologyForm } from '@/elections/MethodologyForm';
import { ReviewerForm } from '@/elections/ReviewerForm';
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
  const t = getTranslator(await getLocale());
  if (!overview || !found) {
    return { title: t('admin.notFound.title') };
  }
  const name = inLanguage(
    found.election.name,
    await getLocale(),
    overview.tenant.defaultLocale,
  )?.text;
  return { title: `${t('admin.election.methodology')} · ${name ?? election}` };
};

/**
 * An election's methodology (editorial workflow E2) and its named external reviewers (E3). Country admins write both
 * while the election is a draft; once it is live they change only through change requests, which have their own
 * screen.
 */
const MethodologyPage = async ({ params }: Params) => {
  const { tenant: slug, election: electionSlug } = await params;
  const [overview, found, data] = await Promise.all([
    getTenant(slug),
    getElection(slug, electionSlug),
    getMethodology(slug, electionSlug),
  ]);
  if (!overview || !found || !data) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const { election } = found;
  const { methodology } = data;
  const editable = data.canEdit && election.status === 'draft';
  const errors = writeErrors(t);
  const path = `/api/t/${tenant.slug}/e/${election.slug}/methodology`;
  const kinds = Object.fromEntries(
    SOURCE_KINDS.map((kind) => [kind, t(`admin.methodology.kinds.${kind}`)]),
  ) as Record<SourceKind, string>;
  const owners = data.demandsOwners.map((owner) => {
    const name = inLanguage(owner.name, locale, tenant.defaultLocale) ?? {
      text: owner.id,
      lang: locale,
    };
    return {
      id: owner.id,
      name: `${name.text} (${t(`admin.methodology.roles.${owner.role}`)})`,
      lang: name.lang,
    };
  });
  const usage = methodology?.usage ?? {};
  /** A message per source kind, built here, where plurals can be. */
  const perKind = (
    counts: Record<string, { quotes: number; checked: number }>,
    say: (used: { quotes: number; checked: number }) => string | undefined,
  ): Partial<Record<SourceKind, string>> =>
    Object.fromEntries(
      SOURCE_KINDS.flatMap((kind) => {
        const line = say(counts[kind] ?? { quotes: 0, checked: 0 });
        return line === undefined ? [] : [[kind, line]];
      }),
    );
  const reviewerText = {
    name: t('admin.methodology.reviewerName'),
    affiliation: t('admin.methodology.affiliation'),
    order: t('admin.methodology.order'),
    consent: t('admin.methodology.consent'),
    save: t('admin.methodology.addReviewer'),
    saved: t('admin.methodology.reviewerSaved'),
    errors,
  };
  return (
    <>
      <h2 className={styles.h2}>{t('admin.election.methodology')}</h2>
      <p className={styles.text}>
        {t('admin.methodology.kind', { kind: t(`admin.methodology.kindNames.${data.kind}`) })}
      </p>
      {editable ? (
        <MethodologyForm
          path={path}
          demands={data.kind === 'demands'}
          owners={owners}
          values={{
            demandsOwnerId: methodology?.demandsOwnerId ?? null,
            body: methodology?.body ?? {},
            admissibleSourceKinds: methodology?.admissibleSourceKinds ?? ['pdf', 'web_page'],
            notMentionedSourceKinds: methodology?.notMentionedSourceKinds ?? ['pdf', 'web_page'],
          }}
          usage={usage}
          locales={localeOptions(tenant, locale)}
          text={{
            owner: t('admin.methodology.owner'),
            ownerHint: t('admin.methodology.ownerHint'),
            body: t('admin.methodology.body'),
            bodyHint: t('admin.texts.bodyHint'),
            needed: t('admin.localized.needed'),
            admissible: t('admin.methodology.admissible'),
            admissibleHint: t('admin.methodology.admissibleHint'),
            notMentioned: t('admin.methodology.notMentioned'),
            notMentionedHint: t('admin.methodology.notMentionedHint'),
            kinds,
            usage: perKind(usage, (used) =>
              used.quotes + used.checked > 0
                ? t('admin.methodology.usage', { quotes: used.quotes, checked: used.checked })
                : undefined,
            ),
            removedQuotes: perKind(usage, (used) =>
              used.quotes > 0
                ? t('admin.methodology.removedQuotes', { count: used.quotes })
                : undefined,
            ),
            removedChecked: perKind(usage, (used) =>
              used.checked > 0
                ? t('admin.methodology.removedChecked', { count: used.checked })
                : undefined,
            ),
            kindsNeeded: t('admin.methodology.kindsNeeded'),
            save: methodology ? t('admin.methodology.save') : t('admin.methodology.create'),
            saved: t('admin.settings.saved'),
            errors,
          }}
        />
      ) : methodology ? (
        <>
          {data.kind === 'demands' ? (
            <p className={styles.text}>
              {t('admin.methodology.owner')}:{' '}
              {owners.find((owner) => owner.id === methodology.demandsOwnerId)?.name}
            </p>
          ) : null}
          {Object.entries(methodology.body).map(([code, body]) => (
            <section key={code} className={styles.versionText}>
              <h3 className={styles.h3}>{languageName(code, locale)}</h3>
              <div className={styles.prose} lang={code}>
                {body}
              </div>
            </section>
          ))}
          <dl className={styles.facts}>
            <dt>{t('admin.methodology.admissible')}</dt>
            <dd>{methodology.admissibleSourceKinds.map((kind) => kinds[kind]).join(', ')}</dd>
            <dt>{t('admin.methodology.notMentioned')}</dt>
            <dd>{methodology.notMentionedSourceKinds.map((kind) => kinds[kind]).join(', ')}</dd>
          </dl>
        </>
      ) : (
        <p className={styles.text}>{t('admin.methodology.none')}</p>
      )}

      {methodology ? (
        <>
          <h2 className={styles.h2}>{t('admin.methodology.reviewers')}</h2>
          <p className={styles.text}>{t('admin.methodology.reviewersIntro')}</p>
          {methodology.reviewers.length === 0 ? (
            <p className={styles.text}>{t('admin.methodology.noReviewers')}</p>
          ) : (
            <ul className={styles.versions}>
              {methodology.reviewers.map((reviewer) => (
                <li key={reviewer.id} className={styles.card}>
                  <strong>{reviewer.name}</strong>
                  <span className={styles.muted}>{reviewer.affiliation}</span>
                  {editable ? (
                    <details className={styles.details}>
                      <summary className={styles.summary}>
                        {t('admin.methodology.editReviewer', { name: reviewer.name })}
                      </summary>
                      <ReviewerForm
                        path={`${path}/reviewers/${reviewer.id}`}
                        method="PATCH"
                        idPrefix={`reviewer-${reviewer.id}`}
                        values={reviewer}
                        text={{
                          ...reviewerText,
                          save: t('admin.settings.save'),
                          saveLabel: t('admin.methodology.saveReviewer', { name: reviewer.name }),
                        }}
                      />
                      <ConfirmButton
                        method="DELETE"
                        path={`${path}/reviewers/${reviewer.id}`}
                        removes
                        text={{
                          button: t('admin.methodology.deleteShort'),
                          label: t('admin.methodology.deleteReviewerLabel', {
                            name: reviewer.name,
                          }),
                          title: t('admin.methodology.deleteReviewerTitle'),
                          body: t('admin.methodology.deleteReviewerBody', { name: reviewer.name }),
                          confirm: t('admin.methodology.deleteReviewer'),
                          cancel: t('admin.members.cancel'),
                          done: t('admin.methodology.reviewerDeleted'),
                          errors,
                        }}
                      />
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editable ? (
            <>
              <h3 className={styles.h3}>{t('admin.methodology.addReviewer')}</h3>
              <ReviewerForm
                path={`${path}/reviewers`}
                method="POST"
                idPrefix="new-reviewer"
                text={reviewerText}
              />
              <h2 className={styles.h2}>{t('admin.methodology.delete')}</h2>
              <ConfirmButton
                method="DELETE"
                path={path}
                removes
                text={{
                  button: t('admin.methodology.delete'),
                  title: t('admin.methodology.deleteTitle'),
                  body: t('admin.methodology.deleteBody'),
                  confirm: t('admin.methodology.delete'),
                  cancel: t('admin.members.cancel'),
                  done: t('admin.methodology.deleted'),
                  errors: { ...errors, linked: t('admin.methodology.deleteLinked') },
                }}
              />
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
};

export default MethodologyPage;
