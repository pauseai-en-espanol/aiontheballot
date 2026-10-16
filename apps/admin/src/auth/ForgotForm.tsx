'use client';

import { Field } from '@ark-ui/react/field';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { fill } from '../fill';
import { type AuthError, authError, describedBy, formText, postAuth } from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface ForgotText {
  email: string;
  submit: string;
  sentTitle: string;
  /** A template with `{email}`. */
  sent: string;
  secondFactor: string;
  back: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const ERROR_ID = 'forgot-error';

/**
 * "I forgot my password" (editorial workflow A5.2; PLAN R170): asks the API for a link to choose a new password. The
 * answer is the same whether or not the address has an account, so the page says only that a link is on its way if
 * there is one. A malformed address is the one refusal it words, since that says nothing about who has an account.
 */
export const ForgotForm = ({ text }: { text: ForgotText }) => {
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sentTo !== undefined) {
      heading.current?.focus();
    }
  }, [sentTo]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const email = formText(event.currentTarget, 'email').trim();
    setPending(true);
    setError(undefined);
    const answer = await postAuth('/request-password-reset', { email });
    setPending(false);
    if (!answer.ok) {
      // A 400 is the address's shape, the same for everyone; but not while the API has no mail to send it with.
      setError(
        answer.status === 400 && answer.body.code !== 'RESET_PASSWORD_DISABLED'
          ? 'invalidEmail'
          : authError(answer),
      );
      return;
    }
    setSentTo(email);
  };

  if (sentTo !== undefined) {
    return (
      <div className={styles.form}>
        <h2 ref={heading} tabIndex={-1} className={styles.subheading}>
          {text.sentTitle}
        </h2>
        <p>{fill(text.sent, { email: sentTo })}</p>
        <p>{text.secondFactor}</p>
        <Link className={styles.link} href="/sign-in">
          {text.back}
        </Link>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <Field.Root className={styles.field} required invalid={error === 'invalidEmail'}>
        <Field.Label className={styles.label}>{text.email}</Field.Label>
        <Field.Input
          className={styles.input}
          name="email"
          type="email"
          autoComplete="username"
          aria-describedby={describedBy(error && ERROR_ID)}
        />
      </Field.Root>
      <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
      <button className={styles.button} type="submit" aria-disabled={pending}>
        {text.submit}
      </button>
      <Link className={styles.link} href="/sign-in">
        {text.back}
      </Link>
    </form>
  );
};
