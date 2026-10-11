'use client';

import { type FormEvent, useState, useSyncExternalStore } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

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
 * said in the page's own status line.
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
    save: string;
    clear: string;
    saved: string;
    cleared: string;
    /** When the end isn't after the start (`elections_check2`). */
    endBeforeStart: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();
  // The inputs show the browser's own time, which the server doesn't know: they render once in the browser.
  const browser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setConstraint(undefined);
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
      setConstraint(answer.constraint);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit} hidden={!browser}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="freeze-from">
          {text.from}
        </label>
        <input
          id="freeze-from"
          className={styles.input}
          name="from"
          type="datetime-local"
          required
          defaultValue={local(from)}
          aria-describedby={error ? 'freeze-error' : undefined}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="freeze-until">
          {text.until}
        </label>
        <p id="freeze-until-hint" className={styles.hint}>
          {text.untilHint}
        </p>
        <input
          id="freeze-until"
          className={styles.input}
          name="until"
          type="datetime-local"
          defaultValue={local(until)}
          aria-describedby={['freeze-until-hint', error ? 'freeze-error' : ''].join(' ').trim()}
        />
      </div>
      <FormMessages
        id="freeze-error"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={
          error && constraint === 'elections_check2'
            ? { ...text.errors, [error]: text.endBeforeStart }
            : text.errors
        }
      />
      <div className={styles.buttonRow}>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
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
      </div>
    </form>
  );
};
