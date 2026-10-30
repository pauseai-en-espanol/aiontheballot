'use client';

import { useState } from 'react';

import * as ui from '@/ui/styles';

import { type AuthError } from './client';
import { FormAlert } from './FormAlert';
import { signInWithPasskey } from './passkey-ceremonies';
import * as styles from './styles';

export interface PasskeySignInText {
  question: string;
  button: string;
  hint: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const ERROR_ID = 'passkey-error';
const HINT_ID = 'passkey-hint';

/**
 * "Use a passkey" (PLAN D22): the device offers the passkeys it holds for this host, checks who holds it, and the
 * sign-in is done, second factor and all. Beside the password, never instead of it. Also how a passkey confirms it's
 * you (PLAN D23): a sign-in afresh, then back to `next`. While a request is out the button is marked busy rather than
 * disabled, so keyboard focus stays on it.
 */
export const PasskeySignIn = ({ next = '/', text }: { next?: string; text: PasskeySignInText }) => {
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);

  const signIn = async () => {
    if (pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    const failed = await signInWithPasskey();
    if (failed) {
      setPending(false);
      setError(failed);
      return;
    }
    window.location.assign(next);
  };

  return (
    <section className={`${styles.form} ${styles.footnote}`} aria-labelledby="passkey-question">
      <h2 id="passkey-question" className={styles.label}>
        {text.question}
      </h2>
      <p id={HINT_ID} className={styles.hint}>
        {text.hint}
      </p>
      <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
      <button
        type="button"
        className={ui.secondaryButton}
        aria-disabled={pending}
        aria-describedby={error ? `${HINT_ID} ${ERROR_ID}` : HINT_ID}
        onClick={() => void signIn()}
      >
        {text.button}
      </button>
    </section>
  );
};
