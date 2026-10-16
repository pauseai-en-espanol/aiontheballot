'use client';

import { type FormEvent, useSyncExternalStore } from 'react';

import { announce } from '@/ui/announce';
import { type Problems, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

type FreezeField = 'from' | 'until';

/** A `datetime-local` value for an instant, in the browser's own time, as the input shows it. */
const local = (iso: string | null): string => {
  if (iso === null) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** An instant from a `datetime-local` value, read in the browser's own time; none when empty. */
const instant = (value: string): string | null =>
  value === '' ? null : new Date(value).toISOString();

/**
 * The election's freeze window (editorial workflow E6): from a start, until an end or until cleared. Inside it nothing
 * public about the election changes: no publishing, no change-request approval, no programme status (the database's
 * rules); drafting and reviewing go on. Country admins and platform admins set and clear it. Times are the browser's
 * own, sent as instants. The form starts again from what was saved (the page keys it by the window), so what it did is
 * said in the page's own status line. What is wrong shows at its field (admin forms §1.2).
 */
export const FreezeForm = ({
  path,
  from,
  until,
  text,
}: {
  path: string;
  from: string | null;
  until: string | null;
  text: {
    from: string;
    until: string;
    untilHint: string;
    /** That the times are in the reader's time zone: with `{zone}`. */
    localTime: string;
    optional: string;
    save: string;
    clear: string;
    saved: string;
    cleared: string;
    /** When the end isn't after the start (`elections_check2`). */
    endBeforeStart: string;
    errors: Record<WriteError, string>;
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<FreezeField>();
  // The inputs show the browser's own time, which the server doesn't know: they render once in the browser.
  const browser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  /** What the form can tell before sending: a start, and an end after it if there is one. */
  const check = (form: HTMLFormElement): Problems<FreezeField> => {
    const start = instant(formText(form, 'from'));
    const end = instant(formText(form, 'until'));
    if (start === null) {
      return { from: text.problems.required };
    }
    return end !== null && end <= start ? { until: text.endBeforeStart } : {};
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (show(check(form))) {
      setError(undefined);
      return;
    }
    const answer = await run(
      () =>
        sendToApi('PATCH', path, {
          frozenFrom: instant(formText(form, 'from')),
          frozenUntil: instant(formText(form, 'until')),
        }),
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.saved);
    } else if (answer) {
      const pointed = refusalProblem(
        answer,
        { elections_check2: ['until', text.endBeforeStart] },
        {
          frozenFrom: ['from', text.problems.invalid],
          frozenUntil: ['until', text.problems.invalid],
        },
      );
      if (pointed && show(pointed)) {
        setError(undefined);
      }
    }
  };
  // Named, as the window's line above names UTC (PLAN R193).
  const zone = browser ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} hidden={!browser} noValidate>
      <p className={styles.hint}>{text.localTime.replace('{zone}', zone)}</p>
      <Field label={text.from} error={problems.from} required>
        <FieldInput
          className={styles.input}
          name="from"
          type="datetime-local"
          defaultValue={local(from)}
        />
      </Field>
      <Field
        label={text.until}
        hint={text.untilHint}
        optional={text.optional}
        error={problems.until}
      >
        <FieldInput
          className={styles.input}
          name="until"
          type="datetime-local"
          defaultValue={local(until)}
        />
      </Field>
      <FormMessages id="freeze-error" error={error} errors={text.errors} />
      {/* The form is drawn again with the new times once saved: what it did is said in the page's own status line. */}
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine}>
        {from !== null ? (
          <button
            className={styles.secondaryButton}
            type="button"
            aria-disabled={pending}
            onClick={() =>
              void run(
                () => sendToApi('PATCH', path, { frozenFrom: null, frozenUntil: null }),
                () => undefined,
              ).then((answer) => {
                if (answer?.ok) {
                  announce(text.cleared);
                }
              })
            }
          >
            {text.clear}
          </button>
        ) : null}
      </FormActions>
    </form>
  );
};
