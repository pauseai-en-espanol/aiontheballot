'use client';

import { type FormEvent, useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { checkValues, type ProblemText } from '@/ui/checks';
import { Field, FieldTextarea } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
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
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<'note'>();
  const [stale, setStale] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setStale(false);
    if (
      show(
        checkValues(
          { note: formText(form, 'note').trim() },
          { note: { required: true } },
          text.problems,
        ),
      )
    ) {
      setError(undefined);
      return;
    }
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
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.label} hint={text.hint} error={problems.note} required>
        <FieldTextarea className={styles.textarea} name="note" maxLength={4000} />
      </Field>
      <FormMessages id={`${id}-error`} error={stale ? undefined : error} errors={text.errors} />
      {stale ? <StaleNotice text={text} /> : null}
      <FormActions label={text.button} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
