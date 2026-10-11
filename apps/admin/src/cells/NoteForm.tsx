'use client';

import { type FormEvent, useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { StaleNotice } from './StaleNotice';

/**
 * A note sent with a step: a comment (C9), or why a cell goes back to its editors (C8), which then needs the version
 * the reviewer saw. The note must say something; the database writes it, and never changes it afterwards.
 */
export const NoteForm = ({
  path,
  version,
  text,
}: {
  path: string;
  /** For a rejection: the version the reviewer saw. */
  version?: number;
  text: {
    label: string;
    hint?: string;
    button: string;
    done: string;
    stale: string;
    reload: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [stale, setStale] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setStale(false);
    const answer = await run(
      () =>
        sendToApi('POST', path, {
          ...(version === undefined ? {} : { version }),
          note: formText(form, 'note'),
        }),
      version === undefined ? text.done : () => undefined,
    );
    if (answer?.ok) {
      form.reset();
      // A rejection takes this form away with the review: the page's own status line says it's done.
      if (version !== undefined) {
        announce(text.done);
      }
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-note`}>
          {text.label}
        </label>
        {text.hint ? (
          <p id={`${id}-hint`} className={styles.hint}>
            {text.hint}
          </p>
        ) : null}
        <textarea
          id={`${id}-note`}
          className={styles.textarea}
          name="note"
          required
          maxLength={4000}
          aria-describedby={
            [text.hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
            undefined
          }
        />
      </div>
      <FormMessages
        id={`${id}-error`}
        error={stale ? undefined : error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      {stale ? <StaleNotice text={text} /> : null}
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.button}
        </button>
      </div>
    </form>
  );
};
