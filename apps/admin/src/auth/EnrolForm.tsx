'use client';

import { Field } from '@ark-ui/react/field';
import { QrCode } from '@ark-ui/react/qr-code';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { type AuthError, authError, cleanCode, describedBy, formText, postAuth } from './client';
import { FormAlert } from './FormAlert';
import * as styles from './styles';

export interface EnrolText {
  passwordStep: string;
  password: string;
  begin: string;
  scanTitle: string;
  scan: string;
  qrLabel: string;
  manual: string;
  code: string;
  codeHint: string;
  verify: string;
  backupTitle: string;
  backupIntro: string;
  backupList: string;
  done: string;
  restart: string;
  errors: Record<AuthError, string>;
}

const ERROR_ID = 'enrol-error';
const HINT_ID = 'enrol-code-hint';

type Step =
  | { kind: 'password' }
  | { kind: 'scan'; uri: string; backupCodes: string[] }
  | { kind: 'codes'; backupCodes: string[] };

/** The key inside an `otpauth://` URI, in groups of four, as authenticator apps ask for it. */
const setupKey = (uri: string): string =>
  (new URL(uri).searchParams.get('secret') ?? '').replace(/(.{4})(?=.)/g, '$1 ');

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * TOTP enrolment (editorial workflow A4.3), the only thing a session without a second factor can do: the password
 * again, then the QR code and its key, then one valid code, and only then the ten backup codes, shown this once.
 * Reloading before the code starts again with a new key; the session becomes aal2 only with the code.
 */
export const EnrolForm = ({ text }: { text: EnrolText }) => {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Each new step takes focus at its heading, so a screen reader starts reading there.
  useEffect(() => {
    if (step.kind !== 'password') {
      heading.current?.focus();
    }
  }, [step.kind]);

  const begin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    const answer = await postAuth('/two-factor/enable', {
      password: formText(event.currentTarget, 'password'),
    });
    setPending(false);
    const { totpURI, backupCodes } = answer.body;
    if (!answer.ok || typeof totpURI !== 'string' || !isStringArray(backupCodes)) {
      setError(authError(answer));
      return;
    }
    setStep({ kind: 'scan', uri: totpURI, backupCodes });
  };

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step.kind !== 'scan' || pending) {
      return;
    }
    setPending(true);
    setError(undefined);
    const answer = await postAuth('/two-factor/verify-totp', {
      code: cleanCode(formText(event.currentTarget, 'code')),
    });
    setPending(false);
    if (!answer.ok) {
      setError(authError(answer));
      return;
    }
    setStep({ kind: 'codes', backupCodes: step.backupCodes });
  };

  if (step.kind === 'password') {
    return (
      <form className={styles.form} onSubmit={begin}>
        <p className={styles.text}>{text.passwordStep}</p>
        <Field.Root className={styles.field} required invalid={error === 'invalidPassword'}>
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
          {text.begin}
        </button>
      </form>
    );
  }

  if (step.kind === 'scan') {
    return (
      <form className={styles.form} onSubmit={verify}>
        <h2 ref={heading} tabIndex={-1} className={styles.subheading}>
          {text.scanTitle}
        </h2>
        <p>{text.scan}</p>
        <QrCode.Root className={styles.qr} value={step.uri}>
          <QrCode.Frame role="img" aria-label={text.qrLabel}>
            <QrCode.Pattern />
          </QrCode.Frame>
        </QrCode.Root>
        <p>{text.manual}</p>
        <p>
          <code className={styles.secret} data-testid="setup-key">
            {setupKey(step.uri)}
          </code>
        </p>
        <Field.Root className={styles.field} required invalid={error === 'invalidCode'}>
          <Field.Label className={styles.label}>{text.code}</Field.Label>
          <Field.HelperText id={HINT_ID} className={styles.hint}>
            {text.codeHint}
          </Field.HelperText>
          <Field.Input
            className={`${styles.input} ${styles.codeInput}`}
            name="code"
            type="text"
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            aria-describedby={describedBy(HINT_ID, error && ERROR_ID)}
          />
        </Field.Root>
        <FormAlert id={ERROR_ID} error={error} messages={text.errors} restart={text.restart} />
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.verify}
        </button>
      </form>
    );
  }

  return (
    <div className={styles.form}>
      <h2 ref={heading} tabIndex={-1} className={styles.subheading}>
        {text.backupTitle}
      </h2>
      <p>{text.backupIntro}</p>
      <ul className={styles.codes} aria-label={text.backupList}>
        {step.backupCodes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button className={styles.button} type="button" onClick={() => window.location.assign('/')}>
        {text.done}
      </button>
    </div>
  );
};
