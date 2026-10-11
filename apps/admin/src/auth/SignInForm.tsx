'use client';

import { Field } from '@ark-ui/react/field';
import { type FormEvent, useState } from 'react';

import { type AuthError, authError, describedBy, formText, postAuth } from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface SignInText {
  email: string;
  password: string;
  submit: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const ERROR_ID = 'sign-in-error';

/**
 * Email and password (editorial workflow A4.1). An enrolled account goes on to its code; a new one, signed in without a
 * second factor, goes straight to enrolment, which is all its session can reach. While a request is out the button is
 * marked busy rather than disabled, so keyboard focus stays on it.
 */
export const SignInForm = ({ text }: { text: SignInText }) => {
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const wrong = error === 'invalidCredentials';

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const form = event.currentTarget;
    setPending(true);
    setError(undefined);
    const answer = await postAuth('/sign-in/email', {
      email: formText(form, 'email').trim(),
      password: formText(form, 'password'),
    });
    if (!answer.ok) {
      setPending(false);
      setError(authError(answer));
      return;
    }
    window.location.assign(
      answer.body.twoFactorRedirect === true ? '/two-factor' : '/two-factor/enrol',
    );
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <Field.Root className={styles.field} required invalid={wrong}>
        <Field.Label className={styles.label}>{text.email}</Field.Label>
        <Field.Input
          className={styles.input}
          name="email"
          type="email"
          autoComplete="username"
          aria-describedby={describedBy(error && ERROR_ID)}
        />
      </Field.Root>
      <Field.Root className={styles.field} required invalid={wrong}>
        <Field.Label className={styles.label}>{text.password}</Field.Label>
        <Field.Input
          className={styles.input}
          name="password"
          type="password"
          autoComplete="current-password"
          aria-describedby={describedBy(error && ERROR_ID)}
        />
      </Field.Root>
      <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
      <button className={styles.button} type="submit" aria-disabled={pending}>
        {text.submit}
      </button>
    </form>
  );
};
