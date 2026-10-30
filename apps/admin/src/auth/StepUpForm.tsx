'use client';

import { Field } from '@ark-ui/react/field';
import { type FormEvent, useState } from 'react';

import { type AuthError, cleanCode, describedBy, formText } from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface StepUpText {
  intro: string;
  code: string;
  submit: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const INTRO_ID = 'step-up-intro';
const ERROR_ID = 'step-up-error';

/** The API's refusals of a code typed to confirm (`POST /api/step-up`), as the sign-in forms word them. */
const ERRORS: Readonly<Record<string, AuthError>> = {
  invalidCode: 'invalidCode',
  tooManyCodes: 'tooManyCodes',
  limit: 'rateLimited',
};

/**
 * What went wrong: the API's refusal, else what its status means (a code left blank is Fastify's own 400; a session
 * that ended, 401).
 */
const stepUpError = async (response: Response | undefined): Promise<AuthError> => {
  if (!response) {
    return 'unexpected';
  }
  const body: unknown = await response.json().catch(() => undefined);
  const key =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  const known = typeof key === 'string' && Object.hasOwn(ERRORS, key) ? ERRORS[key] : undefined;
  return (
    known ??
    (response.status === 401 ? 'expired' : response.status === 400 ? 'invalidCode' : 'unexpected')
  );
};

/**
 * "Confirm it's you" with the authenticator app's code (PLAN D23): the session's second factor is recent again, and the
 * person goes back to `next`. The fifth wrong code ends the session, and the alert says to sign in again. While a
 * request is out the button is marked busy rather than disabled, so keyboard focus stays on it.
 */
export const StepUpForm = ({ next, text }: { next: string; text: StepUpText }) => {
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const code = cleanCode(formText(event.currentTarget, 'code'));
    setPending(true);
    setError(undefined);
    const response = await fetch('/api/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }).catch(() => undefined);
    if (!response?.ok) {
      setPending(false);
      setError(await stepUpError(response));
      return;
    }
    window.location.assign(next);
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <p id={INTRO_ID} className={styles.text}>
        {text.intro}
      </p>
      <Field.Root className={styles.field} required invalid={error === 'invalidCode'}>
        <Field.Label className={styles.label}>{text.code}</Field.Label>
        <Field.Input
          className={`${styles.input} ${styles.codeInput}`}
          name="code"
          type="text"
          autoComplete="one-time-code"
          inputMode="numeric"
          spellCheck={false}
          autoCapitalize="off"
          aria-describedby={describedBy(INTRO_ID, error && ERROR_ID)}
        />
      </Field.Root>
      <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
      <button className={styles.button} type="submit" aria-disabled={pending}>
        {text.submit}
      </button>
    </form>
  );
};
