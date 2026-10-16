'use client';

import type { FormEvent } from 'react';

import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/** A Plausible script's file name, as the API and the database take it. */
const SCRIPT = /^pa-[\w-]{1,100}\.js$/u;

/**
 * A site's Plausible script (PLAN R83, R135): the file name from the Plausible site's installation snippet. Empty, the
 * site is counted nowhere. The API and the database check its form; the check here only spares a wasted save, and
 * says what is wrong at the field (admin forms §1.2).
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
    optional: string;
    /** What a script's name must look like. */
    invalid: string;
    save: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form } = useProblems<'plausibleScript'>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const script = formText(event.currentTarget, 'plausibleScript').trim();
    if (show(script !== '' && !SCRIPT.test(script) ? { plausibleScript: text.invalid } : {})) {
      setError(undefined);
      return;
    }
    const answer = await run(
      () => sendToApi('PUT', path, { plausibleScript: script || null }),
      text.saved,
    );
    // The form's one field: any value the API refuses is its.
    if (
      answer &&
      !answer.ok &&
      answer.error === 'invalid' &&
      show({ plausibleScript: text.invalid })
    ) {
      setError(undefined);
    }
  };
  return (
    <form ref={form} className={styles.form} onSubmit={submit} noValidate>
      <Field
        label={text.script}
        hint={text.scriptHint}
        optional={text.optional}
        error={problems.plausibleScript}
      >
        <FieldInput
          className={styles.input}
          name="plausibleScript"
          maxLength={110}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={value ?? ''}
        />
      </Field>
      <FormMessages id="analytics-error" error={error} errors={text.errors} />
      <FormActions label={text.save} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
