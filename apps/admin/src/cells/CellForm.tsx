'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';

import { type ProblemText, refusalProblem } from '@/ui/checks';
import { FormMessages } from '@/ui/FormMessages';
import { formText, localizedFromForm } from '@/ui/forms';
import { type LocaleOption, LocalizedField } from '@/ui/LocalizedField';
import { RatingIcon } from '@/ui/RatingIcon';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import type { ChangeKind, Rating } from './data';

import { useDraftEditor } from './draft-editor';
import { adoptOwnChange, answeredVersion, onOwnChange } from './own-version';
import { StaleNotice } from './StaleNotice';

export interface CellFormText {
  rating: string;
  noRating: string;
  ratings: Record<string, string>;
  summary: string;
  summaryHint: string;
  changeKind: string;
  changeKindHint: string;
  changeKinds: Record<Exclude<ChangeKind, 'initial'>, string>;
  publicNote: string;
  publicNoteHint: string;
  report: string;
  reportHint: string;
  noReport: string;
  needed: string;
  optional: string;
  saved: string;
  stale: string;
  reload: string;
  errors: Record<WriteError, string>;
  problems: ProblemText;
}

/** The fields a refusal can point at: the texts (a choice is one of the form's own). */
type CellField = 'summary' | 'publicNote';

const ERROR_ID = 'cell-error';

/** The request's fields, as the form names them. */
const BODY_FIELDS: Readonly<Record<string, CellField>> = {
  summary: 'summary',
  publicNote: 'publicNote',
};

/**
 * A draft's rating, summary and, after the first publish, its kind of change, public note and the right-of-reply report
 * it answers (editorial workflow C2, C10, C11), saved all at once at the version its fields were loaded at (C14). When
 * the page reloads its data (after any step, a comment included) with a newer version, untouched fields show it;
 * edited ones keep their text and say at once that the cell changed, rather than saving over someone else's change. A
 * change made from this same page (a quote, a checked document) moves the version they count as loaded at instead,
 * keeping the text (PLAN R190). Its "Save" is the draft bar's, which also sends the draft for review after saving it.
 * The scale is the methodology's; the database checks it, and everything a submission needs, again.
 */
export const CellForm = ({
  path,
  version,
  scale,
  values,
  locales,
  afterFirstPublish,
  reports,
  text,
}: {
  /** The cell's route in the API. */
  path: string;
  version: number;
  scale: readonly Rating[];
  values: {
    rating: Rating | null;
    summary: Record<string, string> | null;
    changeKind: ChangeKind | null;
    publicNote: Record<string, string> | null;
    reportId: string | null;
  };
  /**
   * The reports the draft may answer (C10.4): the election's past triage, and the one it answers now. None for whoever
   * reads no reports (a platform admin, PLAN P11), whose form then leaves the link as it is.
   */
  reports: { id: string; label: string }[];
  /** The site's languages, its main one first and needed to submit. */
  locales: LocaleOption[];
  /** Whether it was published before, so a change needs a kind and a public note. */
  afterFirstPublish: boolean;
  text: CellFormText;
}) => {
  const { error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<CellField>();
  const editor = useDraftEditor();
  const [staleOnSave, setStaleOnSave] = useState(false);
  // The version the fields show, and whether they were edited since: a newer one replaces untouched fields.
  const [loaded, setLoaded] = useState(version);
  const [edited, setEdited] = useState(false);
  const [fields, setFields] = useState(0);
  if (version !== loaded && !edited) {
    setLoaded(version);
    setFields((n) => n + 1);
  }
  const stale = staleOnSave || (version !== loaded && edited);

  // This page's own changes of the cell's content move the version edited fields count as loaded at (R190).
  const editedNow = useRef(edited);
  const setUnsaved = editor?.setUnsaved;
  useEffect(() => {
    editedNow.current = edited;
    setUnsaved?.(edited);
  }, [edited, setUnsaved]);
  useEffect(
    () =>
      onOwnChange((change) => {
        if (editedNow.current) {
          setLoaded((current) => adoptOwnChange(current, change));
        }
      }),
    [],
  );

  /** Saves the fields at the version they were loaded at: the version saved at, or none when refused. */
  const save = async (form: HTMLFormElement): Promise<number | undefined> => {
    const rating = formText(form, 'rating');
    const changeKind = formText(form, 'changeKind');
    const offersReports = afterFirstPublish && reports.length > 0;
    const body = {
      version: loaded,
      rating: rating === '' ? null : rating,
      summary: localizedFromForm(form, 'summary', locales),
      changeKind: afterFirstPublish && changeKind !== '' ? changeKind : null,
      publicNote: afterFirstPublish ? localizedFromForm(form, 'publicNote', locales) : null,
      // Sent only when changed: a form that doesn't offer it, or shows it as it was, leaves the link as it is.
      ...(offersReports && formText(form, 'reportId') !== (values.reportId ?? '')
        ? { reportId: formText(form, 'reportId') || null }
        : {}),
    };
    setStaleOnSave(false);
    show({});
    const answer = await run(() => sendToApi('PUT', path, body), text.saved);
    if (answer?.ok) {
      // Saved: the version the reload brings is these fields' own.
      setEdited(false);
      return answeredVersion(answer.body);
    }
    if (answer?.error === 'cellChanged') {
      setStaleOnSave(true);
    } else if (answer) {
      const pointed = refusalProblem(
        answer,
        {},
        Object.fromEntries(
          Object.entries(BODY_FIELDS).map(([name, field]) => [
            name,
            [field, text.problems.invalid],
          ]),
        ),
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
    }
    return undefined;
  };

  // The bar's "Send for review" saves first, through this.
  const registerSave = editor?.registerSave;
  useEffect(() => {
    const form = formRef.current;
    registerSave?.(() => (form ? save(form) : Promise.resolve(undefined)));
    return () => registerSave?.(null);
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await save(event.currentTarget);
  };

  return (
    <form
      key={fields}
      id="cell-form"
      ref={formRef}
      className={styles.form}
      onSubmit={submit}
      onChange={() => setEdited(true)}
      noValidate
    >
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.rating}</legend>
        {[...scale, null].map((rating) => {
          const id = `cell-rating-${rating ?? 'none'}`;
          return (
            <div key={id} className={styles.checkboxField}>
              <input
                id={id}
                className={styles.checkbox}
                type="radio"
                name="rating"
                value={rating ?? ''}
                defaultChecked={values.rating === rating}
              />
              <label className={styles.ratingBadge} htmlFor={id}>
                {rating === null ? null : <RatingIcon rating={rating} />}
                <span className={styles.label}>
                  {rating === null ? text.noRating : (text.ratings[rating] ?? rating)}
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>
      <LocalizedField
        name="summary"
        label={text.summary}
        hint={text.summaryHint}
        locales={locales}
        values={values.summary ?? {}}
        multiline
        maxLength={4000}
        requiredLabel={text.needed}
        error={problems.summary}
      />
      {afterFirstPublish ? (
        <>
          <fieldset className={styles.fieldset} aria-describedby="cell-change-kind-hint">
            <legend className={styles.label}>{text.changeKind}</legend>
            <p id="cell-change-kind-hint" className={styles.hint}>
              {text.changeKindHint}
            </p>
            {(['update', 'correction', 'withdrawal'] as const).map((kind) => (
              <div key={kind} className={styles.checkboxField}>
                <input
                  id={`cell-change-${kind}`}
                  className={styles.checkbox}
                  type="radio"
                  name="changeKind"
                  value={kind}
                  defaultChecked={values.changeKind === kind}
                />
                <label className={styles.label} htmlFor={`cell-change-${kind}`}>
                  {text.changeKinds[kind]}
                </label>
              </div>
            ))}
          </fieldset>
          <LocalizedField
            name="publicNote"
            label={text.publicNote}
            hint={text.publicNoteHint}
            locales={locales}
            values={values.publicNote ?? {}}
            multiline
            maxLength={2000}
            requiredLabel={text.needed}
            error={problems.publicNote}
          />
          {reports.length > 0 ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cell-report">
                {text.report}
              </label>
              <p id="cell-report-hint" className={styles.hint}>
                {text.reportHint}
              </p>
              <select
                id="cell-report"
                name="reportId"
                className={styles.select}
                defaultValue={values.reportId ?? ''}
                aria-describedby="cell-report-hint"
              >
                <option value="">{text.noReport}</option>
                {reports.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={stale ? undefined : error}
        status={status}
        errors={text.errors}
      />
      {stale ? <StaleNotice text={{ stale: text.stale, reload: text.reload }} /> : null}
    </form>
  );
};
