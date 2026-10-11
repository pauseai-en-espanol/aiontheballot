'use client';

import { type FormEvent, useId, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { StaleNotice } from './StaleNotice';

/**
 * Records that one of the party's documents was checked for "not mentioned" (editorial workflow C3); the database
 * stamps when, and refuses a document of a kind the methodology doesn't list.
 */
export const CheckedForm = ({
  path,
  version,
  sources,
  text,
}: {
  path: string;
  version: number;
  sources: { id: string; title: string }[];
  text: {
    label: string;
    choose: string;
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
      () => sendToApi('POST', path, { version, sourceId: formText(form, 'sourceId') }),
      text.done,
    );
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-source`}>
          {text.label}
        </label>
        <select
          id={`${id}-source`}
          className={styles.select}
          name="sourceId"
          required
          defaultValue=""
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <option value="" disabled>
            {text.choose}
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
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
