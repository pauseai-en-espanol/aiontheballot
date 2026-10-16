'use client';

import { Field } from '@ark-ui/react/field';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { type AuthError, authError, describedBy, formText, postAuth } from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface SetPasswordText {
  intro: string;
  missing: string;
  password: string;
  passwordHint: string;
  confirm: string;
  submit: string;
  doneTitle: string;
  done: string;
  signIn: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const ERROR_ID = 'set-password-error';
const HINT_ID = 'set-password-hint';

/** At least this long (the API's rule, editorial workflow A5.1); the browser says so before the API has to. */
const MIN_LENGTH = 12;

/** The link's token, from the fragment (`#token=…`), which no server ever sees (apps/api/src/auth/accounts.ts). */
const readToken = (): string | null =>
  new URLSearchParams(window.location.hash.slice(1)).get('token') || null;

/** Takes the token out of the address bar and the back/forward list (not the browser's global history). */
const hideToken = () => window.history.replaceState(null, '', window.location.pathname);

/**
 * A password from a single-use link (editorial workflow A1.1): typed twice, checked here only so a slip of the finger
 * isn't saved, and by the API for its length. It signs nobody in: the person then signs in, and enrols TOTP. A link
 * opened or pasted into this page while it is open changes only the fragment, so it is read as it arrives.
 */
export const SetPasswordForm = ({ text }: { text: SetPasswordText }) => {
  // Rendered in the browser only (SetPasswordLoader), so the fragment is there to read.
  const [token, setToken] = useState(readToken);
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (readToken()) {
      hideToken();
    }
    const arrived = () => {
      const found = readToken();
      if (found) {
        hideToken();
        setToken(found);
        setError(undefined);
        setDone(false);
      }
    };
    window.addEventListener('hashchange', arrived);
    return () => window.removeEventListener('hashchange', arrived);
  }, []);

  useEffect(() => {
    if (done) {
      heading.current?.focus();
    }
  }, [done]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const form = event.currentTarget;
    const newPassword = formText(form, 'password');
    if (newPassword !== formText(form, 'confirm')) {
      // Cleared first, so the alert speaks again when the same slip is made twice.
      flushSync(() => setError(undefined));
      setError('passwordsDiffer');
      confirmInput.current?.focus();
      return;
    }
    setPending(true);
    setError(undefined);
    const answer = await postAuth('/reset-password', { token, newPassword });
    setPending(false);
    if (!answer.ok) {
      setError(authError(answer));
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className={styles.form}>
        <h2 ref={heading} tabIndex={-1} className={styles.subheading}>
          {text.doneTitle}
        </h2>
        <p>{text.done}</p>
        <Link className={styles.link} href="/sign-in">
          {text.signIn}
        </Link>
      </div>
    );
  }

  if (token === null) {
    return <p className={styles.text}>{text.missing}</p>;
  }

  const tooShort = error === 'passwordTooShort' || error === 'passwordTooLong';
  return (
    <form className={styles.form} onSubmit={submit}>
      <p className={styles.text}>{text.intro}</p>
      <Field.Root
        className={styles.field}
        required
        invalid={tooShort || error === 'passwordsDiffer'}
      >
        <Field.Label className={styles.label}>{text.password}</Field.Label>
        <Field.HelperText id={HINT_ID} className={styles.hint}>
          {text.passwordHint}
        </Field.HelperText>
        <Field.Input
          className={styles.input}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          aria-describedby={describedBy(HINT_ID, error && ERROR_ID)}
        />
      </Field.Root>
      <Field.Root className={styles.field} required invalid={error === 'passwordsDiffer'}>
        <Field.Label className={styles.label}>{text.confirm}</Field.Label>
        <Field.Input
          ref={confirmInput}
          className={styles.input}
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
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
