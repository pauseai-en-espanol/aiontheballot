import type { Metadata } from 'next';

import { RATING_SCALES } from '@aiontheballot/domain/methodology';
import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AttestationUpload } from '@/cells/AttestationUpload';
import { CellAction } from '@/cells/CellAction';
import { CellForm } from '@/cells/CellForm';
import { CheckedForm } from '@/cells/CheckedForm';
import { attestationLapses, checkedOnlyReplaced, submitChecklist } from '@/cells/checklist';
import { formatClipTime } from '@/cells/clip-time';
import { ClipForm } from '@/cells/ClipForm';
import { cellsPath, getCell, type Rating } from '@/cells/data';
import { DraftBar } from '@/cells/DraftBar';
import { DraftEditor } from '@/cells/DraftEditor';
import { NoteForm } from '@/cells/NoteForm';
import { QuoteForm } from '@/cells/QuoteForm';
import { StartChange } from '@/cells/StartChange';
import { UnsavedHint } from '@/cells/UnsavedHint';
import { getTenant } from '@/data';
import { getLocale } from '@/locale';
import { inLanguage } from '@/localized';
import { getReports } from '@/reports/data';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Lang } from '@/ui/Lang';
import { languageInSentence, localeOptions } from '@/ui/locales';
import { RatingBadge } from '@/ui/RatingIcon';
import * as styles from '@/ui/styles';
import { problemText, template, writeErrors } from '@/ui/text';

interface CellParams {
  params: Promise<{ tenant: string; election: string; party: string; criterion: string }>;
}

export const generateMetadata = async ({ params }: CellParams): Promise<Metadata> => {
  const { tenant: slug, election, party, criterion } = await params;
  const [overview, cell] = await Promise.all([
    getTenant(slug),
    getCell(slug, election, party, criterion),
  ]);
  const locale = await getLocale();
  const t = getTranslator(locale);
  if (!overview || !cell) {
    return { title: t('admin.notFound.title') };
  }
  const local = (value: Record<string, string>) =>
    inLanguage(value, locale, overview.tenant.defaultLocale)?.text ?? '';
  return {
    title: `${local(cell.party.shortName)} · ${local(cell.criterion.title)} · ${t('admin.cells.title')}`,
  };
};

/**
 * One cell (editorial workflow §8): its draft and what it needs (C2, C3, C10, C11), its quotes with where each matches
 * (C2), the workflow open to the user (C5–C8, C13), its recheck flag (C12), its comments and trail (C9), and every
 * published revision. What is offered follows the user's roles; the database decides every step again.
 */
const CellPage = async ({ params }: CellParams) => {
  const { tenant: slug, election, party, criterion } = await params;
  const [overview, cell, reports] = await Promise.all([
    getTenant(slug),
    getCell(slug, election, party, criterion),
    getReports(slug),
  ]);
  if (!overview || !cell) {
    notFound();
  }
  const { tenant } = overview;
  const locale = await getLocale();
  const t = getTranslator(locale);
  const errors = writeErrors(t);
  const stale = { stale: t('admin.cells.stale'), reload: t('admin.cells.reload') };
  const local = (value: Record<string, string> | null) =>
    value ? inLanguage(value, locale, tenant.defaultLocale) : undefined;
  const partyName = local(cell.party.shortName) ?? { text: cell.party.slug, lang: locale };
  const criterionName = local(cell.criterion.title) ?? { text: cell.criterion.slug, lang: locale };
  const can = (...roles: ('country_admin' | 'editor' | 'reviewer')[]) =>
    cell.platformAdmin || roles.some((role) => cell.roles.includes(role));
  const canEdit = can('editor', 'country_admin');
  const canReview = can('reviewer', 'country_admin');
  const { draft } = cell;
  const grid = `/t/${tenant.slug}/e/${election}/cells`;
  const api = cellsPath(tenant.slug, election);
  const cellApi = draft ? `${api}/${draft.id}` : api;
  // The election's sources in the API, from the browser: each source's text and its live match.
  const matchBase = `/api/t/${encodeURIComponent(tenant.slug)}/e/${encodeURIComponent(election)}/sources`;
  const editable = draft?.state !== 'in_review' && canEdit;
  const youContributed = draft?.contributors.includes(cell.you) ?? false;
  // Who may attest a quote (C4.2, PLAN R167): any member, but while four-eyes is on not its author nor a contributor
  // as four-eyes counts them (the draft's editors and uploaders). The database decides again.
  const canAttest = can('editor', 'reviewer', 'country_admin');
  const youUploaded = draft?.uploaders.includes(cell.you) ?? false;
  const attestRefusal = (quote: { createdBy: string }) =>
    !cell.requireSecondReviewer
      ? undefined
      : quote.createdBy === cell.you
        ? t('admin.cells.attestation.authorCannot')
        : youContributed || youUploaded
          ? t('admin.cells.attestation.contributorCannot')
          : undefined;
  const sizeOf = (bytes: number) =>
    bytes < 1_000_000
      ? new Intl.NumberFormat(locale, {
          style: 'unit',
          unit: 'kilobyte',
          maximumFractionDigits: 0,
        }).format(Math.max(1, bytes / 1000))
      : new Intl.NumberFormat(locale, {
          style: 'unit',
          unit: 'megabyte',
          maximumFractionDigits: 1,
        }).format(bytes / 1_000_000);
  const nameOf = (id: string) => cell.names[id] ?? t('admin.cells.someone');
  const ratingWords = (rating: Rating | null) =>
    rating !== null
      ? t(`rating.${rating}`)
      : draft?.changeKind === 'withdrawal'
        ? t('admin.cells.ratingWithdrawal')
        : t('admin.cells.noRating');
  const sourceLang = (source: { language: string | null }) =>
    source.language ?? tenant.defaultLocale;
  // Publishing needs an election in preview or live (PLAN R181), or an archived one for a correction or withdrawal
  // (C7.6).
  const publishable =
    cell.electionStatus === 'preview' ||
    cell.electionStatus === 'live' ||
    (cell.electionStatus === 'archived' &&
      (draft?.changeKind === 'correction' || draft?.changeKind === 'withdrawal'));
  // A rejection's note is both a comment and the rejection's own: shown once, with the rejection.
  const events = (draft?.events ?? []).filter(
    (event, index, all) =>
      !(
        event.kind === 'commented' &&
        all[index + 1]?.kind === 'rejected' &&
        all[index + 1]?.note === event.note &&
        all[index + 1]?.actorId === event.actorId
      ),
  );
  const scale = RATING_SCALES[tenant.methodologyKind];
  // Reports a correction may answer (C10.4): the election's past triage, as for a change request (CR1.8), and the one
  // the draft answers now, whatever its status, even past the list's length. None for whoever reads no reports (a
  // platform admin), whose form then leaves the link as it is.
  // Members of the site read its reports, whatever else they are (PLAN P11).
  const readable = reports?.canTriage === true;
  const listed = (reports?.reports ?? [])
    .filter(
      (report) =>
        report.id === draft?.reportId ||
        (report.election?.slug === election &&
          (report.status === 'triaged' || report.status === 'accepted')),
    )
    .map((report) => ({
      id: report.id,
      label: `${new Date(report.createdAt).toLocaleDateString(locale, { dateStyle: 'medium' })} · ${t(
        `admin.reports.kinds.${report.kind}`,
      )}${report.excerpt ? ` · ${report.excerpt.slice(0, 60)}` : ''}`,
    }));
  const reportOptions =
    readable && draft?.reportId && !listed.some((option) => option.id === draft.reportId)
      ? [{ id: draft.reportId, label: t('admin.cells.reportCurrent') }, ...listed]
      : readable
        ? listed
        : [];
  // A replaced source takes no new quote or check (PLAN D14); the ones it has stay, marked as resting on it.
  const replaced = new Set(cell.sources.filter((s) => s.replaced).map((s) => s.id));
  const replacedNote = (id: string) =>
    replaced.has(id) ? ` · ${t('admin.cells.replacedSource')}` : '';
  const citable = cell.sources.filter((s) => s.citable && s.admittedForQuotes && !s.replaced);
  const checkable = cell.sources.filter(
    (s) =>
      s.citable &&
      s.admittedForChecks &&
      !s.replaced &&
      !draft?.checkedDocuments.some((c) => c.source.id === s.id),
  );
  const live = {
    matched: template(t, 'admin.cells.live.matched'),
    tooShortStored: template(t, 'admin.cells.live.tooShortStored'),
    tooShortNormalised: template(t, 'admin.cells.live.tooShortNormalised'),
    tooLong: template(t, 'admin.cells.live.tooLong'),
    unmatched: template(t, 'admin.cells.live.unmatched'),
    longestStart: template(t, 'admin.cells.live.longestStart'),
    longestEnd: template(t, 'admin.cells.live.longestEnd'),
    failed: template(t, 'admin.cells.live.failed'),
  };

  return (
    <>
      <p>
        <Link className={styles.link} href={grid}>
          {t('admin.cells.back')}
        </Link>
      </p>
      <h2 className={styles.h2}>
        <Lang value={partyName} page={locale} /> · <Lang value={criterionName} page={locale} />
      </h2>
      {draft ? (
        <p className={styles.text}>
          {t('admin.cells.state', {
            state: t(
              `admin.cells.states.${draft.state === 'draft' && cell.revisions.length > 0 ? 'published_with_draft' : draft.state}`,
            ),
          })}{' '}
          · {t('admin.cells.version', { version: draft.contentVersion })}
        </p>
      ) : null}

      {checkedOnlyReplaced(cell) ? (
        // D20 (PLAN R187): a warning, never a refusal.
        <section aria-labelledby="replaced-only" className={styles.notice}>
          <h3 id="replaced-only" className={styles.h3}>
            <span aria-hidden="true">⚠ </span>
            {t('admin.cells.replacedOnlyTitle')}
          </h3>
          <p>{t('admin.cells.replacedOnlyBody')}</p>
        </section>
      ) : null}

      {draft?.recheckReason ? (
        <section aria-labelledby="recheck" className={styles.notice}>
          <h3 id="recheck" className={styles.h3}>
            {t('admin.cells.recheckTitle')}
          </h3>
          <p>{t('admin.cells.recheckBody')}</p>
          {canEdit ? (
            <CellAction
              method="DELETE"
              path={`${cellApi}/recheck`}
              secondary
              text={{
                button: t('admin.cells.clearRecheck'),
                done: t('admin.cells.recheckCleared'),
                ...stale,
                errors,
              }}
            />
          ) : null}
        </section>
      ) : null}

      {!draft ? (
        <section aria-labelledby="draft" className={styles.section}>
          <h3 id="draft" className={styles.h3}>
            {t('admin.cells.draftTitle')}
          </h3>
          <p className={styles.text}>{t('admin.cells.notStarted')}</p>
          {canEdit ? (
            <CellAction
              method="POST"
              path={api}
              body={{ partyId: cell.party.id, criterionId: cell.criterion.id }}
              text={{
                button: t('admin.cells.create'),
                done: t('admin.cells.created'),
                ...stale,
                errors,
              }}
            />
          ) : null}
        </section>
      ) : (
        <>
          {(() => {
            const editor = (
              <DraftEditor leave={t('admin.cells.bar.leave')}>
                <section aria-labelledby="draft" className={styles.section}>
                  <h3 id="draft" className={styles.h3}>
                    {t('admin.cells.draftTitle')}
                  </h3>
                  {draft.state === 'in_review' ? (
                    <p className={styles.notice}>{t('admin.cells.locked')}</p>
                  ) : null}
                  {editable &&
                  draft.reportId &&
                  (cell.revisions.length === 0 || reportOptions.length === 0) ? (
                    // The form doesn't offer it here (before the first publish, or for whoever reads no reports): said all
                    // the same, since submitting sends it for review with the rest.
                    <p className={styles.text}>
                      <Link
                        className={styles.link}
                        href={`/t/${tenant.slug}/reports/${draft.reportId}`}
                      >
                        {t('admin.cells.answersReportDraft')}
                      </Link>
                    </p>
                  ) : null}
                  {editable ? (
                    <CellForm
                      path={cellApi}
                      version={draft.contentVersion}
                      scale={scale}
                      values={{
                        rating: draft.rating,
                        summary: draft.summary,
                        changeKind: draft.changeKind,
                        publicNote: draft.publicNote,
                        reportId: draft.reportId,
                      }}
                      locales={localeOptions(tenant, locale)}
                      afterFirstPublish={cell.revisions.length > 0}
                      reports={reportOptions}
                      text={{
                        rating: t('admin.cells.rating'),
                        noRating: t('admin.cells.noRating'),
                        ratings: Object.fromEntries(scale.map((r) => [r, t(`rating.${r}`)])),
                        summary: t('admin.cells.summary'),
                        summaryHint: t('admin.cells.summaryHint'),
                        changeKind: t('admin.cells.changeKind'),
                        changeKindHint: t('admin.cells.changeKindHint'),
                        changeKinds: {
                          update: t('admin.cells.changeKinds.update'),
                          correction: t('admin.cells.changeKinds.correction'),
                          withdrawal: t('admin.cells.changeKinds.withdrawal'),
                        },
                        publicNote: t('admin.cells.publicNote'),
                        // In preview, the note is never published (PLAN R181).
                        publicNoteHint:
                          cell.electionStatus === 'preview'
                            ? t('admin.cells.publicNoteHintPreview')
                            : t('admin.cells.publicNoteHint'),
                        report: t('admin.cells.report'),
                        reportHint: t('admin.cells.reportHint'),
                        noReport: t('admin.cells.noReport'),
                        needed: t('admin.localized.needed'),
                        optional: t('admin.form.optional'),
                        problems: problemText(t),
                        saved: t('admin.cells.saved'),
                        ...stale,
                        errors,
                      }}
                    />
                  ) : (
                    <dl className={styles.facts}>
                      <dt>{t('admin.cells.rating')}</dt>
                      <dd>
                        {draft.rating === null ? (
                          ratingWords(draft.rating)
                        ) : (
                          <RatingBadge rating={draft.rating} label={ratingWords(draft.rating)} />
                        )}
                      </dd>
                      <dt>{t('admin.cells.summary')}</dt>
                      <dd>
                        {local(draft.summary) ? (
                          <Lang
                            value={local(draft.summary) ?? { text: '', lang: locale }}
                            page={locale}
                          />
                        ) : (
                          '—'
                        )}
                      </dd>
                      {draft.changeKind ? (
                        <>
                          <dt>{t('admin.cells.changeKind')}</dt>
                          <dd>{t(`admin.cells.changeKindsAll.${draft.changeKind}`)}</dd>
                        </>
                      ) : null}
                      {local(draft.publicNote) ? (
                        <>
                          <dt>{t('admin.cells.publicNote')}</dt>
                          <dd>
                            <Lang
                              value={local(draft.publicNote) ?? { text: '', lang: locale }}
                              page={locale}
                            />
                          </dd>
                        </>
                      ) : null}
                      {draft.reportId ? (
                        <>
                          <dt>{t('admin.cells.report')}</dt>
                          <dd>
                            {/* Private (C10.4): never on the public site. */}
                            <Link
                              className={styles.link}
                              href={`/t/${tenant.slug}/reports/${draft.reportId}`}
                            >
                              {t('admin.cells.answersReportDraft')}
                            </Link>
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  )}
                </section>

                <section aria-labelledby="quotes" className={styles.section}>
                  <h3 id="quotes" className={styles.h3}>
                    {t('admin.cells.quotes')}
                  </h3>
                  <p className={styles.text}>{t('admin.cells.quotesIntro')}</p>
                  {draft.quotes.length === 0 ? (
                    <p className={styles.text}>{t('admin.cells.noQuotes')}</p>
                  ) : (
                    <ol className={styles.list}>
                      {draft.quotes.map((quote) => (
                        <li key={quote.id}>
                          <blockquote className={styles.text} lang={sourceLang(quote.source)}>
                            {quote.quote}
                          </blockquote>
                          <p className={styles.hint}>
                            {quote.matchStatus === 'matched'
                              ? t('admin.cells.matched', { location: quote.location ?? '' })
                              : quote.matchStatus === 'attested'
                                ? attestationLapses(draft, cell.requireSecondReviewer, quote)
                                  ? `⚠ ${t('admin.cells.attestation.lapses', { name: nameOf(quote.attestedBy ?? '') })}`
                                  : t('admin.cells.attestation.attestedBy', {
                                      name: nameOf(quote.attestedBy ?? ''),
                                    })
                                : quote.withText
                                  ? `⚠ ${t('admin.cells.unmatched')}`
                                  : `⚠ ${t('admin.cells.attestation.notYet')}`}
                            {' · '}
                            {t('admin.cells.source', { title: quote.source.title })}
                            {replacedNote(quote.source.id)}
                            {quote.sectionLabel
                              ? ` · ${t('admin.cells.section', { label: quote.sectionLabel })}`
                              : ''}
                          </p>
                          {quote.withText ? null : (
                            <div className={styles.form}>
                              <p className={styles.hint}>
                                {quote.attestationFile ? (
                                  <>
                                    {t('admin.cells.attestation.file', {
                                      size: sizeOf(quote.attestationFile.byteSize),
                                    })}{' '}
                                    <a
                                      className={styles.link}
                                      href={`${cellApi}/quotes/${quote.id}/attestation/file`}
                                      download
                                    >
                                      {t('admin.cells.attestation.download')}
                                    </a>
                                  </>
                                ) : (
                                  t('admin.cells.attestation.noFile')
                                )}
                              </p>
                              {quote.source.kind === 'video' || quote.source.kind === 'audio' ? (
                                <p className={styles.hint}>
                                  {quote.clip
                                    ? t('admin.cells.attestation.clip', {
                                        start: formatClipTime(quote.clip.start),
                                        end:
                                          quote.clip.end === null
                                            ? '…'
                                            : formatClipTime(quote.clip.end),
                                      })
                                    : t('admin.cells.attestation.noClip')}
                                </p>
                              ) : null}
                              {quote.matchStatus === 'attested' && canAttest ? (
                                <CellAction
                                  method="DELETE"
                                  path={`${cellApi}/quotes/${quote.id}/attestation`}
                                  secondary
                                  label={`${t('admin.cells.attestation.withdraw')}: ${quote.quote.slice(0, 60)}`}
                                  text={{
                                    button: t('admin.cells.attestation.withdraw'),
                                    done: t('admin.cells.attestation.withdrawn'),
                                    ...stale,
                                    errors,
                                  }}
                                />
                              ) : null}
                              {quote.matchStatus !== 'attested' && canAttest ? (
                                !quote.attestationFile ? (
                                  <p className={styles.hint}>
                                    {t('admin.cells.attestation.needsFile')}
                                  </p>
                                ) : attestRefusal(quote) ? (
                                  <p className={styles.hint}>{attestRefusal(quote)}</p>
                                ) : (
                                  <>
                                    <p className={styles.hint}>
                                      {t('admin.cells.attestation.attestHint')}
                                    </p>
                                    <CellAction
                                      method="POST"
                                      path={`${cellApi}/quotes/${quote.id}/attestation`}
                                      body={{ version: draft.contentVersion }}
                                      label={`${t('admin.cells.attestation.attest')}: ${quote.quote.slice(0, 60)}`}
                                      text={{
                                        button: t('admin.cells.attestation.attest'),
                                        done: t('admin.cells.attestation.attested'),
                                        ...stale,
                                        errors,
                                      }}
                                    />
                                  </>
                                )
                              ) : null}
                              {editable ? (
                                <>
                                  {quote.source.kind === 'video' ||
                                  quote.source.kind === 'audio' ? (
                                    <ClipForm
                                      path={`${cellApi}/quotes/${quote.id}`}
                                      version={draft.contentVersion}
                                      clip={quote.clip}
                                      label={`${t('admin.cells.attestation.clipLabel')}: ${quote.quote.slice(0, 60)}`}
                                      text={{
                                        legend: t('admin.cells.attestation.clipLegend'),
                                        start: t('admin.cells.attestation.clipStart'),
                                        end: t('admin.cells.attestation.clipEnd'),
                                        save: t('admin.cells.attestation.clipSave'),
                                        saved: t('admin.cells.attestation.clipSaved'),
                                        ...stale,
                                        errors,
                                        endAfterStart: t('admin.cells.clipEndAfterStart'),
                                        timeHint: t('admin.cells.attestation.clipTimeHint'),
                                        timeInvalid: t('admin.cells.attestation.clipTimeInvalid'),
                                        problems: problemText(t),
                                      }}
                                    />
                                  ) : null}
                                  <AttestationUpload
                                    path={`${cellApi}/quotes/${quote.id}/attestation/file`}
                                    version={draft.contentVersion}
                                    label={`${t(
                                      quote.attestationFile
                                        ? 'admin.cells.attestation.replaceLabel'
                                        : 'admin.cells.attestation.fileLabel',
                                    )}: ${quote.quote.slice(0, 60)}`}
                                    text={{
                                      fileHint: t('admin.cells.attestation.fileHint'),
                                      contributor: t('admin.cells.attestation.contributor'),
                                      upload: t(
                                        quote.attestationFile
                                          ? 'admin.cells.attestation.replace'
                                          : 'admin.cells.attestation.upload',
                                      ),
                                      uploaded: t('admin.cells.attestation.uploaded'),
                                      ...stale,
                                      errors: {
                                        ...errors,
                                        fileType: t('admin.cells.attestation.fileType'),
                                        otherType: t('admin.cells.attestation.otherType'),
                                      },
                                    }}
                                  />
                                </>
                              ) : null}
                            </div>
                          )}
                          {editable ? (
                            <CellAction
                              method="DELETE"
                              path={`${cellApi}/quotes/${quote.id}?version=${draft.contentVersion}`}
                              secondary
                              label={`${t('admin.cells.removeQuote')}: ${quote.quote.slice(0, 60)}`}
                              text={{
                                button: t('admin.cells.removeQuote'),
                                done: t('admin.cells.quoteRemoved'),
                                ...stale,
                                errors,
                              }}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  )}
                  {editable ? (
                    citable.length === 0 ? (
                      <p className={styles.notice}>{t('admin.cells.noCitable')}</p>
                    ) : (
                      <>
                        <h4 className={styles.label}>{t('admin.cells.addQuote')}</h4>
                        <QuoteForm
                          path={`${cellApi}/quotes`}
                          matchBase={matchBase}
                          version={draft.contentVersion}
                          sources={citable.map((s) => ({
                            id: s.id,
                            title: s.title,
                            lang: sourceLang(s),
                          }))}
                          text={{
                            source: t('admin.cells.quoteSource'),
                            chooseSource: t('admin.cells.chooseSource'),
                            quote: t('admin.cells.quote'),
                            quoteHint: t('admin.cells.quoteHint'),
                            sectionLabel: t('admin.cells.sectionLabel'),
                            sectionLabelHint: t('admin.cells.sectionLabelHint'),
                            add: t('admin.cells.add'),
                            added: t('admin.cells.added'),
                            ...stale,
                            live,
                            pick: {
                              title: t('admin.cells.pick.title'),
                              hint: t('admin.cells.pick.hint'),
                              button: t('admin.cells.pick.button'),
                              loading: t('admin.cells.pick.loading'),
                              failed: t('admin.cells.pick.failed'),
                              none: t('admin.cells.pick.none'),
                              nothing: t('admin.cells.pick.nothing'),
                              tooLong: template(t, 'admin.cells.pick.tooLong'),
                              done: template(t, 'admin.cells.pick.done'),
                            },
                            optional: t('admin.form.optional'),
                            errors,
                            problems: problemText(t),
                          }}
                        />
                      </>
                    )
                  ) : null}
                </section>

                {draft.rating === 'not_mentioned' || draft.checkedDocuments.length > 0 ? (
                  <section aria-labelledby="checked" className={styles.section}>
                    <h3 id="checked" className={styles.h3}>
                      {t('admin.cells.checked')}
                    </h3>
                    <p className={styles.text}>{t('admin.cells.checkedIntro')}</p>
                    {draft.checkedDocuments.length === 0 ? (
                      <p className={styles.text}>{t('admin.cells.noChecked')}</p>
                    ) : (
                      <ul className={styles.list}>
                        {draft.checkedDocuments.map((checked) => (
                          <li key={checked.source.id}>
                            {t('admin.cells.checkedOn', {
                              title: checked.source.title,
                              date: new Date(checked.checkedAt),
                              name: nameOf(checked.checkedBy),
                            })}
                            {replacedNote(checked.source.id)}
                            {editable ? (
                              <CellAction
                                method="DELETE"
                                path={`${cellApi}/checked/${checked.source.id}?version=${draft.contentVersion}`}
                                secondary
                                label={`${t('admin.cells.removeChecked')}: ${checked.source.title}`}
                                text={{
                                  button: t('admin.cells.removeChecked'),
                                  done: t('admin.cells.checkedRemoved'),
                                  ...stale,
                                  errors,
                                }}
                              />
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {editable ? (
                      checkable.length === 0 ? (
                        <p className={styles.text}>{t('admin.cells.noCheckable')}</p>
                      ) : (
                        <CheckedForm
                          path={`${cellApi}/checked`}
                          version={draft.contentVersion}
                          sources={checkable.map(({ id, title }) => ({ id, title }))}
                          text={{
                            label: t('admin.cells.addChecked'),
                            choose: t('admin.cells.chooseSource'),
                            button: t('admin.cells.addCheckedButton'),
                            done: t('admin.cells.checkedAdded'),
                            ...stale,
                            errors,
                            problems: problemText(t),
                          }}
                        />
                      )
                    ) : null}
                  </section>
                ) : null}

                <section aria-labelledby="workflow" className={styles.section}>
                  <h3 id="workflow" className={styles.h3}>
                    {t('admin.cells.actions')}
                  </h3>
                  {draft.contributors.length > 0 ? (
                    <p className={styles.text}>
                      {t('admin.cells.contributors', {
                        names: draft.contributors.map(nameOf).join(', '),
                      })}
                    </p>
                  ) : null}
                  {draft.state === 'draft' && canEdit ? (
                    // What submitting needs, as the database will check it (C5.2): a sign and words for each.
                    <section aria-labelledby="checklist">
                      <h4 id="checklist" className={styles.label}>
                        {t('admin.cells.checklist.title')}
                      </h4>
                      <p className={styles.hint}>{t('admin.cells.checklist.intro')}</p>
                      <UnsavedHint text={t('admin.cells.bar.checklistUnsaved')} />
                      <ul className={styles.checklist}>
                        {submitChecklist({ ...cell, draft }, tenant.defaultLocale).map((item) => (
                          <li
                            key={item.need}
                            className={styles.checkItem}
                            data-done={item.done ? '' : undefined}
                          >
                            <span aria-hidden="true">{item.done ? '✓' : '✗'}</span>
                            <span>
                              <span className={styles.visuallyHidden}>
                                {item.done
                                  ? t('admin.cells.checklist.done')
                                  : t('admin.cells.checklist.missing')}
                                :{' '}
                              </span>
                              {t(`admin.cells.checklist.${item.need}`, {
                                language: languageInSentence(tenant.defaultLocale, locale),
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <div className={styles.buttonRow}>
                    {draft.state === 'in_review' && youContributed ? (
                      <CellAction
                        method="POST"
                        path={`${cellApi}/recall`}
                        body={{ version: draft.contentVersion }}
                        secondary
                        text={{
                          button: t('admin.cells.recall'),
                          done: t('admin.cells.recalled'),
                          ...stale,
                          errors,
                        }}
                      />
                    ) : null}
                    {draft.state === 'in_review' && canReview ? (
                      !publishable ? (
                        <p className={styles.notice}>{t('admin.cells.publishNotYet')}</p>
                      ) : youContributed && cell.requireSecondReviewer ? (
                        <p className={styles.notice}>{t('admin.cells.cannotPublishOwn')}</p>
                      ) : (
                        <ConfirmButton
                          method="POST"
                          path={`${cellApi}/publish`}
                          body={{ version: draft.contentVersion }}
                          secondary={false}
                          removes
                          text={{
                            button: t('admin.cells.publish'),
                            title: t('admin.cells.publishTitle'),
                            body: youContributed
                              ? t('admin.cells.publishSelfBody')
                              : t('admin.cells.publishBody'),
                            confirm: t('admin.cells.publish'),
                            cancel: t('admin.members.cancel'),
                            done: t('admin.cells.published'),
                            errors,
                          }}
                        />
                      )
                    ) : null}
                    {draft.generation === 0 &&
                    draft.state === 'draft' &&
                    draft.events.length === 0 &&
                    canEdit ? (
                      <ConfirmButton
                        method="DELETE"
                        path={`${cellApi}?version=${draft.contentVersion}`}
                        then={grid}
                        text={{
                          button: t('admin.cells.delete'),
                          title: t('admin.cells.deleteTitle'),
                          body: t('admin.cells.deleteBody'),
                          confirm: t('admin.cells.delete'),
                          cancel: t('admin.members.cancel'),
                          done: t('admin.cells.deleted'),
                          errors,
                        }}
                      />
                    ) : null}
                  </div>
                  {draft.state === 'in_review' && canReview && !youContributed ? (
                    <NoteForm
                      path={`${cellApi}/reject`}
                      version={draft.contentVersion}
                      text={{
                        label: t('admin.cells.rejectNote'),
                        hint: t('admin.cells.rejectNoteHint'),
                        button: t('admin.cells.rejectButton'),
                        done: t('admin.cells.rejectedDone'),
                        ...stale,
                        errors,
                        problems: problemText(t),
                      }}
                    />
                  ) : null}
                </section>

                {editable ? (
                  <DraftBar
                    submitPath={`${cellApi}/submit`}
                    version={draft.contentVersion}
                    canSubmit={draft.state === 'draft'}
                    text={{
                      title: t('admin.cells.bar.title'),
                      state: t(`admin.cells.bar.states.${draft.state}`),
                      unsaved: t('admin.cells.bar.unsaved'),
                      saved: t('admin.cells.bar.saved'),
                      save: t('admin.cells.save'),
                      submit: t('admin.cells.submit'),
                      submitted: t('admin.cells.submitted'),
                      ...stale,
                      errors,
                    }}
                  />
                ) : null}
              </DraftEditor>
            );
            // A published cell opens behind an explicit step, not straight into an editable draft (PLAN R197).
            return draft.state === 'published' && editable ? (
              <StartChange
                text={{
                  notice: t('admin.cells.startChange.notice'),
                  button: t('admin.cells.startChange.button'),
                }}
              >
                {editor}
              </StartChange>
            ) : (
              editor
            );
          })()}

          <section aria-labelledby="comments" className={styles.section}>
            <h3 id="comments" className={styles.h3}>
              {t('admin.cells.comments')}
            </h3>
            {events.length === 0 ? (
              <p className={styles.text}>{t('admin.cells.noComments')}</p>
            ) : (
              <ol className={styles.list}>
                {events.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`}>
                    <p>
                      <strong>
                        {t(`admin.cells.events.${event.kind}`, { name: nameOf(event.actorId) })}
                      </strong>
                      {' · '}
                      {t('admin.cells.on', { date: new Date(event.createdAt) })}
                    </p>
                    {event.note ? <p className={styles.text}>{event.note}</p> : null}
                  </li>
                ))}
              </ol>
            )}
            <NoteForm
              path={`${cellApi}/comments`}
              text={{
                label: t('admin.cells.comment'),
                button: t('admin.cells.commentButton'),
                done: t('admin.cells.commented'),
                ...stale,
                errors,
                problems: problemText(t),
              }}
            />
          </section>
        </>
      )}

      <section aria-labelledby="history" className={styles.section}>
        <h3 id="history" className={styles.h3}>
          {t('admin.cells.history')}
        </h3>
        {cell.revisions.length === 0 ? (
          <p className={styles.text}>{t('admin.cells.noHistory')}</p>
        ) : (
          <ol className={styles.list}>
            {cell.revisions.map((revision) => (
              <li key={revision.revisionNo}>
                <p>
                  <strong>
                    {t('admin.cells.revision', {
                      number: revision.revisionNo,
                      date: new Date(revision.publishedAt),
                    })}
                  </strong>
                  {' · '}
                  {t(`admin.cells.changeKindsAll.${revision.changeKind}`)}
                  {' · '}
                  {revision.rating === null ? (
                    <RatingBadge rating="withdrawn" label={t('admin.cells.withdrawn')} />
                  ) : (
                    <RatingBadge rating={revision.rating} label={t(`rating.${revision.rating}`)} />
                  )}
                </p>
                {local(revision.publicNote) ? (
                  <p className={styles.text}>
                    <Lang
                      value={local(revision.publicNote) ?? { text: '', lang: locale }}
                      page={locale}
                    />
                  </p>
                ) : null}
                {revision.internal ? (
                  // Private (H1.1): never on the public site.
                  <p className={styles.hint}>
                    {t('admin.cells.internal', {
                      contributors: revision.internal.contributors.map(nameOf).join(', '),
                      publisher: nameOf(revision.internal.publisher),
                    })}
                    {revision.internal.selfReviewed ? ` ${t('admin.cells.selfReviewed')}` : null}
                    {revision.internal.reportId ? (
                      <>
                        {' '}
                        <Link
                          className={styles.link}
                          href={`/t/${tenant.slug}/reports/${revision.internal.reportId}`}
                        >
                          {t('admin.cells.answersReport')}
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
};

export default CellPage;
