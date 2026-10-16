'use client';

import type { FormEvent } from 'react';

import { checkValues, type ProblemText, refusalProblem } from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

type ReviewerField = 'name' | 'affiliation' | 'order' | 'consent';

/** The request's fields, as the form names them. */
const BODY_FIELDS: Readonly<Record<string, ReviewerField>> = {
  name: 'name',
  affiliation: 'affiliation',
  displayOrder: 'order',
};

/**
 * A named external reviewer of the methodology (editorial workflow E3): name, affiliation and order. Their name will be
 * public, so adding one asks the country admin to confirm the person agreed to be named (W10); the confirmation isn't
 * stored. Names are personal data, which the database never audits. What is wrong shows at its field (admin forms
 * §1.2).
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
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<ReviewerField>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const found = checkValues(
      {
        name: formText(form, 'name').trim(),
        affiliation: formText(form, 'affiliation').trim(),
        order: formText(form, 'order').trim(),
        consent: method === 'POST' ? new FormData(form).get('consent') === 'on' : true,
      },
      {
        name: { required: true },
        affiliation: { required: true },
        order: { whole: { min: 0, max: 10_000 } },
        consent: { required: true },
      },
      text.problems,
    );
    if (show(found)) {
      setError(undefined);
      return;
    }
    const answer = await run(
      () =>
        sendToApi(method, path, {
          name: formText(form, 'name').trim(),
          affiliation: formText(form, 'affiliation').trim(),
          displayOrder: Number(formText(form, 'order') || 0),
        }),
      text.saved,
    );
    if (answer && !answer.ok) {
      // A blank name is refused before the database, naming nothing.
      const pointed =
        refusalProblem(
          answer,
          {},
          Object.fromEntries(
            Object.entries(BODY_FIELDS).map(([name, field]) => [
              name,
              [field, text.problems.invalid],
            ]),
          ),
        ) ??
        (answer.error === 'incomplete' && answer.constraint === undefined
          ? { name: text.problems.required }
          : undefined);
      if (pointed && show(pointed)) {
        setError(undefined);
      }
      return;
    }
    if (answer?.ok && method === 'POST') {
      form.reset();
    }
  };
  const errorId = `${idPrefix}-error`;
  const consentError = `${idPrefix}-consent-error`;
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.name} error={problems.name} required>
        <FieldInput
          className={styles.input}
          name="name"
          maxLength={200}
          defaultValue={values?.name}
          autoComplete="off"
        />
      </Field>
      <Field label={text.affiliation} error={problems.affiliation} required>
        <FieldInput
          className={styles.input}
          name="affiliation"
          maxLength={300}
          defaultValue={values?.affiliation}
          autoComplete="off"
        />
      </Field>
      <Field label={text.order} error={problems.order}>
        <FieldInput
          className={styles.numberInput}
          name="order"
          type="number"
          inputMode="numeric"
          min={0}
          max={10_000}
          step={1}
          defaultValue={values?.displayOrder ?? 0}
        />
      </Field>
      {method === 'POST' ? (
        <div className={styles.field}>
          <div className={styles.checkboxField}>
            <input
              id={`${idPrefix}-consent`}
              className={styles.checkbox}
              name="consent"
              type="checkbox"
              aria-invalid={problems.consent ? true : undefined}
              aria-describedby={problems.consent ? consentError : undefined}
            />
            <label htmlFor={`${idPrefix}-consent`}>{text.consent}</label>
          </div>
          {problems.consent ? (
            <p id={consentError} className={styles.fieldError}>
              <span aria-hidden="true">⚠</span>
              <span>{problems.consent}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      <FormMessages id={errorId} error={error} errors={text.errors} />
      <FormActions
        label={text.save}
        buttonLabel={text.saveLabel}
        pending={pending}
        status={status}
        statusRef={statusLine}
      />
    </form>
  );
};
