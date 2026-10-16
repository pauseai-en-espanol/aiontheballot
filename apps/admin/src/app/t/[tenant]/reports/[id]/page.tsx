import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import { css, cx } from '@styled-system/css';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage, siteName } from '@/localized';
import { getReport, REPORT_STATUSES, type ReportStatus } from '@/reports/data';
import { TriageForm } from '@/reports/TriageForm';
import { requireStage } from '@/session';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { FormSection } from '@/ui/FormSection';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';
import { problemText, writeErrors } from '@/ui/text';

type Params = { params: Promise<{ tenant: string; id: string }> };

/** Text shown as written: its line breaks kept, nothing rendered (R99). */
const asWritten = css({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });

export const generateMetadata = async ({ params }: Params): Promise<Metadata> => {
  const overview = await getTenant((await params).tenant);
  const locale = await getLocale();
  const t = getTranslator(locale);
  return {
    title: overview
      ? `${t('admin.reports.detail.title')} · ${siteName(overview.tenant, locale).text}`
      : t('admin.notFound.title'),
  };
};

/**
 * One report (editorial workflow H2): who sent it and what they say, what it is about, its triage with the internal
 * note, the corrections and change requests that answer it (H2.4), and, for country admins, removing its personal data
 * on request (H2.5).
 */
const ReportPage = async ({ params }: Params) => {
  await requireStage('signed-in');
  const { tenant: slug, id } = await params;
  const [overview, found] = await Promise.all([getTenant(slug), getReport(slug, id)]);
  if (!overview || !found) {
    notFound();
  }
  const { report, names, canTriage, canAnonymize } = found;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const { tenant } = overview;
  const base = `/t/${tenant.slug}/reports`;
  const api = `/api/t/${tenant.slug}/reports/${report.id}`;
  const statuses = Object.fromEntries(
    REPORT_STATUSES.map((value) => [value, t(`admin.reports.statuses.${value}`)]),
  ) as Record<ReportStatus, string>;
  const date = (instant: string) =>
    new Date(instant).toLocaleDateString(locale, { dateStyle: 'long' });
  const local = (value: Parameters<typeof inLanguage>[0]) =>
    inLanguage(value, locale, tenant.defaultLocale);
  const election = report.election ? local(report.election.name) : undefined;
  const party = report.cell ? local(report.cell.partyName) : undefined;
  const criterion = report.cell ? local(report.cell.criterionName) : undefined;
  const given = (value: string | null) => value ?? t('admin.reports.detail.none');
  return (
    <>
      <p>
        <Link className={styles.link} href={base}>
          {t('admin.reports.detail.back')}
        </Link>
      </p>
      <h1 className={styles.h1}>
        {t('admin.reports.detail.title')}: {statuses[report.status]} ·{' '}
        {t(`admin.reports.kinds.${report.kind}`)}
      </h1>
      <dl className={styles.facts}>
        <dt>{t('admin.reports.received')}</dt>
        <dd>
          {new Date(report.createdAt).toLocaleString(locale, {
            dateStyle: 'long',
            timeStyle: 'short',
          })}
        </dd>
        <dt>{t('admin.reports.about')}</dt>
        <dd>
          {election ? (
            <Link
              className={styles.link}
              href={`/t/${tenant.slug}/e/${report.election?.slug ?? ''}`}
            >
              <Lang value={election} page={locale} />
            </Link>
          ) : (
            t('admin.reports.wholeElection')
          )}
          {report.cell && party && criterion && report.election ? (
            <>
              {' · '}
              <Link
                className={styles.link}
                href={`/t/${tenant.slug}/e/${report.election.slug}/cells/${report.cell.party}/${report.cell.criterion}`}
              >
                <Lang value={party} page={locale} /> · <Lang value={criterion} page={locale} />
              </Link>
            </>
          ) : null}
        </dd>
        {report.anonymized ? (
          <>
            <dt>{t('admin.reports.detail.from')}</dt>
            <dd>{t('admin.reports.anonymized')}</dd>
          </>
        ) : (
          <>
            <dt>{t('admin.reports.detail.name')}</dt>
            <dd>{given(report.name)}</dd>
            <dt>{t('admin.reports.detail.email')}</dt>
            <dd>
              {report.email ? (
                <a className={styles.link} href={`mailto:${report.email}`}>
                  {report.email}
                </a>
              ) : (
                given(null)
              )}
            </dd>
            <dt>{t('admin.reports.detail.organization')}</dt>
            <dd>{given(report.organization)}</dd>
          </>
        )}
        {report.partyRepresentative ? (
          <>
            <dt>{t('admin.reports.detail.from')}</dt>
            <dd>{t('admin.reports.representative')}</dd>
          </>
        ) : null}
      </dl>
      {report.message !== null ? (
        <section aria-labelledby="report-message">
          <h2 id="report-message" className={styles.h2}>
            {t('admin.reports.detail.message')}
          </h2>
          {/* Shown as written: line breaks kept, nothing rendered (R99). */}
          <p className={cx(styles.text, asWritten)}>{report.message}</p>
          <p className={styles.hint}>
            {t('admin.reports.detail.removedOn', {
              date: date(`${report.anonymizeAfter}T12:00:00Z`),
            })}
          </p>
        </section>
      ) : null}
      <section aria-labelledby="report-triage">
        <h2 id="report-triage" className={styles.h2}>
          {t('admin.reports.triage.title')}
        </h2>
        {report.triagedAt ? (
          <p className={styles.text}>
            {t('admin.reports.detail.triagedBy', {
              name:
                (report.triagedBy ? names[report.triagedBy] : undefined) ??
                t('admin.reports.notMember'),
              date: date(report.triagedAt),
            })}
          </p>
        ) : null}
        {canTriage ? (
          <TriageForm
            path={`${api}/status`}
            status={report.status}
            note={report.resolutionNote}
            withNote={!report.anonymized}
            text={{
              status: t('admin.reports.triage.status'),
              keep: t('admin.reports.triage.keep', { status: statuses[report.status] }),
              statuses,
              meanings: {
                triaged: t('admin.reports.meanings.triaged'),
                accepted: t('admin.reports.meanings.accepted'),
                rejected: t('admin.reports.meanings.rejected'),
                spam: t('admin.reports.meanings.spam'),
              },
              note: t('admin.reports.triage.note'),
              noteHint: t('admin.reports.triage.noteHint'),
              save: t('admin.reports.triage.save'),
              saved: t('admin.reports.triage.saved'),
              decided: t('admin.reports.triage.decided'),
              optional: t('admin.form.optional'),
              errors: writeErrors(t),
              problems: problemText(t),
            }}
          />
        ) : report.resolutionNote ? (
          <p className={cx(styles.text, asWritten)}>{report.resolutionNote}</p>
        ) : null}
      </section>
      <section aria-labelledby="report-links">
        <h2 id="report-links" className={styles.h2}>
          {t('admin.reports.links.title')}
        </h2>
        {report.changeRequests.length === 0 && report.corrections.length === 0 ? (
          <p className={styles.text}>{t('admin.reports.links.none')}</p>
        ) : null}
        {report.corrections.length > 0 ? (
          <>
            <h3 className={styles.h3}>{t('admin.reports.links.corrections')}</h3>
            <ul className={styles.list}>
              {report.corrections.map((correction) => (
                <li key={`${correction.party}/${correction.criterion}/${correction.revisionNo}`}>
                  <Link
                    className={styles.link}
                    href={`/t/${tenant.slug}/e/${correction.election}/cells/${correction.party}/${correction.criterion}`}
                  >
                    {t('admin.reports.links.revision', {
                      number: correction.revisionNo,
                      party: correction.party,
                      criterion: correction.criterion,
                      date: date(correction.publishedAt),
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {report.election && canTriage ? (
          // A change of the election's structure because of it (admin forms §2, reports; PLAN R196): its forms name it.
          <p className={styles.text}>
            <Link
              className={styles.link}
              href={`/t/${tenant.slug}/e/${report.election.slug}/changes`}
            >
              {t('admin.reports.proposeChange')}
            </Link>{' '}
            <span className={styles.hint}>{t('admin.reports.proposeChangeHint')}</span>
          </p>
        ) : null}
        {report.changeRequests.length > 0 ? (
          <>
            <h3 className={styles.h3}>{t('admin.reports.links.changeRequests')}</h3>
            <ul className={styles.list}>
              {report.changeRequests.map((change) => (
                <li key={change.id}>
                  <Link
                    className={styles.link}
                    href={`/t/${tenant.slug}/e/${change.election}/changes`}
                  >
                    {t('admin.reports.links.change', {
                      kind: t(`admin.changes.kinds.${change.targetKind as 'election'}`),
                      state: t(`admin.changes.states.${change.state as 'pending'}`),
                      date: date(change.proposedAt),
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
      {canAnonymize && !report.anonymized ? (
        // Last on the page, apart: it can't be undone (admin forms §1.4).
        <FormSection id="report-anonymize" title={t('admin.reports.anonymize.button')} danger>
          <ConfirmButton
            method="POST"
            path={`${api}/anonymize`}
            text={{
              button: t('admin.reports.anonymize.button'),
              title: t('admin.reports.anonymize.title'),
              body: t('admin.reports.anonymize.body'),
              confirm: t('admin.reports.anonymize.confirm'),
              cancel: t('admin.reports.anonymize.cancel'),
              done: t('admin.reports.anonymize.done'),
              errors: writeErrors(t),
            }}
          />
        </FormSection>
      ) : null}
    </>
  );
};

export default ReportPage;
