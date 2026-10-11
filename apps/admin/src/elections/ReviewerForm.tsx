'use client';

import type { FormEvent } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * A named external reviewer of the methodology (editorial workflow E3): name, affiliation and order. Their name will be
 * public, so adding one asks the country admin to confirm the person agreed to be named (W10); the confirmation isn't
 * stored. Names are personal data, which the database never audits.
 */
export const ReviewerForm = ({
  path,
  method,
  values,
  idPrefix,
  text,
}: {
  path: string;
  method: 'POST' | 'PATCH';
  values?: { name: string; affiliation: string; displayOrder: number };
  idPrefix: string;
  text: {
    name: string;
    affiliation: string;
    order: string;
    consent: string;
    save: string;
    /** The save button's name, when several such forms are on the page ("Save {name}"). */
    saveLabel?: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const answer = await run(
      () =>
        sendToApi(method, path, {
          name: formText(form, 'name').trim(),
          affiliation: formText(form, 'affiliation').trim(),
          displayOrder: Number(formText(form, 'order') || 0),
        }),
      text.saved,
    );
    if (answer?.ok && method === 'POST') {
      form.reset();
    }
  };
  const errorId = `${idPrefix}-error`;
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-name`}>
          {text.name}
        </label>
        <input
          id={`${idPrefix}-name`}
          className={styles.input}
          name="name"
          required
          maxLength={200}
          defaultValue={values?.name}
          autoComplete="off"
          aria-describedby={error ? errorId : undefined}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-affiliation`}>
          {text.affiliation}
        </label>
        <input
          id={`${idPrefix}-affiliation`}
          className={styles.input}
          name="affiliation"
          required
          maxLength={300}
          defaultValue={values?.affiliation}
          autoComplete="off"
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-order`}>
          {text.order}
        </label>
        <input
          id={`${idPrefix}-order`}
          className={styles.numberInput}
          name="order"
          type="number"
          inputMode="numeric"
          min={0}
          max={10_000}
          step={1}
          defaultValue={values?.displayOrder ?? 0}
        />
      </div>
      {method === 'POST' ? (
        <div className={styles.checkboxField}>
          <input id={`${idPrefix}-consent`} className={styles.checkbox} type="checkbox" required />
          <label htmlFor={`${idPrefix}-consent`}>{text.consent}</label>
        </div>
      ) : null}
      <FormMessages
        id={errorId}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <div>
        <button
          className={styles.button}
          type="submit"
          aria-label={text.saveLabel}
          aria-disabled={pending}
        >
          {text.save}
        </button>
      </div>
    </form>
  );
};
