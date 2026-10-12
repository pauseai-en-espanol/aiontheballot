'use client';

import { type FormEvent, useId } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * A site's Plausible script (PLAN R83, R135): the file name from the Plausible site's installation snippet. Empty, the
 * site is counted nowhere. The API and the database check its form; the pattern here only spares a wasted save.
 */
export const AnalyticsForm = ({
  path,
  value,
  text,
}: {
  path: string;
  value: string | null;
  text: {
    script: string;
    scriptHint: string;
    save: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const script = formText(event.currentTarget, 'plausibleScript').trim();
    await run(() => sendToApi('PUT', path, { plausibleScript: script || null }), text.saved);
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-script`}>
          {text.script}
        </label>
        <p id={`${id}-hint`} className={styles.hint}>
          {text.scriptHint}
        </p>
        <input
          id={`${id}-script`}
          className={styles.input}
          name="plausibleScript"
          maxLength={110}
          pattern="pa-[A-Za-z0-9_\-]{1,100}\.js"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={value ?? ''}
          aria-invalid={error === 'invalid' ? true : undefined}
          aria-describedby={[`${id}-hint`, error ? `${id}-error` : ''].join(' ').trim()}
        />
      </div>
      <FormMessages
        id={`${id}-error`}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
