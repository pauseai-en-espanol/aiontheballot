'use client';

import { type FormEvent, useId, useState } from 'react';

import type { ProblemText } from '@/ui/checks';

import { Field, FieldSelect } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { announceOwnChange } from './own-version';
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
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<'source'>();
  const [stale, setStale] = useState(false);
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setStale(false);
    if (formText(form, 'sourceId') === '') {
      show({ source: text.problems.choose });
      setError(undefined);
      return;
    }
    show({});
    const answer = await run(async () => {
      const sent = await sendToApi('POST', path, { version, sourceId: formText(form, 'sourceId') });
      if (sent.ok) {
        announceOwnChange(version, sent.body);
      }
      return sent;
    }, text.done);
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.label} error={problems.source} required>
        <FieldSelect className={styles.select} name="sourceId" defaultValue="">
          <option value="" disabled>
            {text.choose}
          </option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </FieldSelect>
      </Field>
      <FormMessages id={`${id}-error`} error={stale ? undefined : error} errors={text.errors} />
      {stale ? <StaleNotice text={text} /> : null}
      <FormActions label={text.button} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
