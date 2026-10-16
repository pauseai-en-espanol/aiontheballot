'use client';

import { Field } from '@ark-ui/react/field';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import {
  type AuthError,
  authError,
  cleanBackupCode,
  cleanCode,
  describedBy,
  formText,
  postAuth,
} from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface ChallengeText {
  intro: string;
  code: string;
  submit: string;
  useBackupCode: string;
  backupIntro: string;
  backupCode: string;
  useAuthenticator: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const INTRO_ID = 'challenge-intro';
const ERROR_ID = 'challenge-error';

/**
 * The second step of every sign-in (editorial workflow A4.1, A4.4): a code from the authenticator app, or one of the
 * backup codes. There is no "trust this device": the API passes no such choice on.
 */
export const ChallengeForm = ({ text }: { text: ChallengeText }) => {
  const [backup, setBackup] = useState(false);
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const switched = useRef(false);

  // Switching between the app and a backup code moves focus to the field that changed.
  useEffect(() => {
    if (switched.current) {
      input.current?.focus();
    }
  }, [backup]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const typed = formText(event.currentTarget, 'code');
    setPending(true);
    setError(undefined);
    const answer = backup
      ? await postAuth('/two-factor/verify-backup-code', { code: cleanBackupCode(typed) })
      : await postAuth('/two-factor/verify-totp', { code: cleanCode(typed) });
    if (!answer.ok) {
      setPending(false);
      setError(authError(answer));
      return;
    }
    window.location.assign('/');
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <p id={INTRO_ID} className={styles.text}>
        {backup ? text.backupIntro : text.intro}
      </p>
      <Field.Root className={styles.field} required invalid={error === 'invalidCode'}>
        <Field.Label className={styles.label}>{backup ? text.backupCode : text.code}</Field.Label>
        <Field.Input
          ref={input}
          key={backup ? 'backup' : 'totp'}
          className={`${styles.input} ${styles.codeInput}`}
          name="code"
          type="text"
          autoComplete={backup ? 'off' : 'one-time-code'}
          inputMode={backup ? 'text' : 'numeric'}
          spellCheck={false}
          autoCapitalize="off"
          aria-describedby={describedBy(INTRO_ID, error && ERROR_ID)}
        />
      </Field.Root>
      <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
      <button className={styles.button} type="submit" aria-disabled={pending}>
        {text.submit}
      </button>
      <button
        className={styles.textButton}
        type="button"
        onClick={() => {
          switched.current = true;
          setError(undefined);
          setBackup((value) => !value);
        }}
      >
        {backup ? text.useAuthenticator : text.useBackupCode}
      </button>
    </form>
  );
};
