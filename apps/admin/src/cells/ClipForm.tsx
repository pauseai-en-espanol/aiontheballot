'use client';

import { type FormEvent, useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { type Problems, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { formatClipTime, parseClipTime } from './clip-time';
import { announceOwnChange } from './own-version';
import { StaleNotice } from './StaleNotice';

/**
 * Where in a video or audio clip a quote is said (editorial workflow C4.1): its start and end in seconds, to the
 * millisecond. A change of the quote, which undoes an attestation. The database checks that the end follows the start.
 */
export const ClipForm = ({
  path,
  version,
  clip,
  label,
  text,
}: {
  /** The quote's route in the API. */
  path: string;
  version: number;
  clip: { start: number; end: number | null } | null;
  /** The save button's accessible name, which names the quote. */
  label: string;
  text: {
    legend: string;
    start: string;
    end: string;
    save: string;
    saved: string;
    stale: string;
    reload: string;
    /** That the end must come after the start. */
    endAfterStart: string;
    /** How a time is written, as `1:23`, under the legend. */
    timeHint: string;
    /** When a time isn't one. */
    timeInvalid: string;
    errors: Record<WriteError, string>;
    problems: ProblemText;
  };
}) => {
  const { pending, error, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<'start' | 'end'>();
  const [stale, setStale] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStale(false);
    // As people write them, `1:23` (PLAN R196), to the millisecond as the database keeps them: two times that round
    // to one are no span.
    const form = event.currentTarget;
    const typed = (name: 'start' | 'end') => formText(form, name).trim();
    const found: Problems<'start' | 'end'> = {};
    const seconds = (name: 'start' | 'end'): number => {
      const value = parseClipTime(typed(name));
      if (typed(name) === '') {
        found[name] = text.problems.required;
      } else if (value === undefined) {
        found[name] = text.timeInvalid;
      }
      return value ?? 0;
    };
    const start = seconds('start');
    const end = seconds('end');
    if (found.start === undefined && found.end === undefined && end <= start) {
      found.end = text.endAfterStart;
    }
    if (show(found)) {
      setError(undefined);
      return;
    }
    const answer = await run(
      async () => {
        const sent = await sendToApi('PATCH', path, { version, clip: { start, end } });
        if (sent.ok) {
          announceOwnChange(version, sent.body);
        }
        return sent;
      },
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.saved);
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    } else if (answer && !answer.ok) {
      const pointed = refusalProblem(answer, {
        draft_evidence_check1: ['end', text.endAfterStart],
      });
      if (pointed && show(pointed)) {
        setError(undefined);
      }
    }
  };
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.legend}</legend>
        <p className={styles.hint}>{text.timeHint}</p>
        <div className={styles.inlineForm}>
          {(['start', 'end'] as const).map((name) => (
            <Field key={name} label={text[name]} error={problems[name]} required>
              <FieldInput
                className={styles.input}
                name={name}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0:00"
                size={10}
                defaultValue={
                  clip?.[name] === undefined || clip[name] === null
                    ? ''
                    : formatClipTime(clip[name])
                }
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <FormMessages
        id={`${id}-error`}
        error={stale ? undefined : error}
        status=""
        errors={text.errors}
      />
      {stale ? <StaleNotice text={text} /> : null}
      <div>
        <button
          className={styles.secondaryButton}
          type="submit"
          aria-label={label}
          aria-disabled={pending}
        >
          {text.save}
        </button>
      </div>
    </form>
  );
};
