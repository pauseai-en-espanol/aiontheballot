'use client';

import type { FormEvent } from 'react';

import type { ReportStatus } from '@/reports/data';

import { type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldTextarea } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Where a report may go from where it is (editorial workflow H2.2; PLAN R16), as the report rules allow; from "new", a
 * decision too, which the API takes through triage in the same step (PLAN R196).
 */
const NEXT: Readonly<Record<ReportStatus, readonly Exclude<ReportStatus, 'new'>[]>> = {
  new: ['triaged', 'accepted', 'rejected', 'spam'],
  triaged: ['accepted', 'rejected', 'spam'],
  accepted: [],
  rejected: [],
  spam: [],
};

type TriageField = 'status' | 'note';

/**
 * Moves a report on, with its internal note (H2.2, H2.3): the statuses the rules allow from where it is, as radios that
 * say what each means (admin forms §2, reports), or keeping it there to change only the note. The database decides
 * again, and stamps who triaged it and when. A value the API refuses is marked at its field (admin forms §1.2).
 */
export const TriageForm = ({
  path,
  status,
  note,
  withNote = true,
  text,
}: {
  path: string;
  status: ReportStatus;
  note: string | null;
  /** Without a note once its personal data is gone (the note goes with it): the status still moves on. */
  withNote?: boolean;
  text: {
    status: string;
    keep: string;
    statuses: Record<ReportStatus, string>;
    /** What each status it can move to means. */
    meanings: Record<Exclude<ReportStatus, 'new'>, string>;
    note: string;
    noteHint: string;
    optional: string;
    save: string;
    saved: string;
    decided: string;
    errors: Record<WriteError, string>;
    problems: ProblemText;
  };
}) => {
  const { pending, error, status: done, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<TriageField>();
  const options = [...(status === 'new' ? [] : [status]), ...NEXT[status]];
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    show({});
    const answer = await run(
      () =>
        sendToApi('POST', path, {
          status: formText(form, 'status'),
          ...(withNote ? { resolutionNote: formText(form, 'note').trim() || null } : {}),
        }),
      text.saved,
    );
    if (answer && !answer.ok) {
      const pointed = refusalProblem<TriageField>(
        answer,
        {},
        {
          status: ['status', text.problems.invalid],
          resolutionNote: ['note', text.problems.invalid],
        },
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
    }
  };
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      {NEXT[status].length === 0 ? <p className={styles.hint}>{text.decided}</p> : null}
      <fieldset
        className={styles.fieldset}
        role="radiogroup"
        tabIndex={-1}
        aria-invalid={problems.status ? true : undefined}
        aria-describedby={problems.status ? 'report-status-error' : undefined}
      >
        <legend className={styles.label}>{text.status}</legend>
        {options.map((option) => (
          <div key={option}>
            <div className={styles.checkboxField}>
              <input
                id={`report-status-${option}`}
                className={styles.checkbox}
                type="radio"
                name="status"
                value={option}
                defaultChecked={option === (NEXT[status][0] ?? status)}
                aria-describedby={option === status ? undefined : `report-status-${option}-hint`}
              />
              <label htmlFor={`report-status-${option}`}>
                {option === status ? text.keep : text.statuses[option]}
              </label>
            </div>
            {option === status ? null : (
              <p id={`report-status-${option}-hint`} className={styles.hint}>
                {text.meanings[option]}
              </p>
            )}
          </div>
        ))}
        {problems.status ? (
          <p id="report-status-error" className={styles.fieldError}>
            <span aria-hidden="true">⚠</span>
            <span>{problems.status}</span>
          </p>
        ) : null}
      </fieldset>
      {withNote ? (
        <Field
          label={text.note}
          hint={text.noteHint}
          optional={text.optional}
          error={problems.note}
        >
          <FieldTextarea
            name="note"
            className={styles.textarea}
            maxLength={5_000}
            rows={4}
            defaultValue={note ?? ''}
          />
        </Field>
      ) : null}
      <FormMessages id="report-error" error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={done} statusRef={statusLine} />
    </form>
  );
};
