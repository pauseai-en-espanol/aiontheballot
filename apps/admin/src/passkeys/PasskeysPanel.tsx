'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useRef, useState } from 'react';

import { type AuthError } from '@/auth/client';
import { confirmPath, here } from '@/auth/confirm';
import { FormAlert } from '@/auth/FormAlert';
import { addPasskey } from '@/auth/passkey-ceremonies';
import { fill } from '@/fill';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { type WriteError } from '@/write';

export interface PasskeyRow {
  id: string;
  /** What its owner called it, else where it is kept, else the page's word for one. */
  name: string;
  /** Where it is kept ("1Password"), when the device said; already in words. */
  keptIn: string;
  /** The day it was added, as the page's language writes it. */
  added: string;
}

export interface PasskeysText {
  add: string;
  name: string;
  optional: string;
  nameHint: string;
  submit: string;
  added: string;
  list: string;
  none: string;
  columns: Record<'name' | 'keptIn' | 'added' | 'actions', string>;
  remove: {
    button: string;
    /** With `{name}`. */
    label: string;
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    done: string;
  };
  restart: string;
  authErrors: Record<AuthError, string>;
  errors: Record<WriteError, string>;
}

/**
 * A member's passkeys (PLAN D22): adding one on this device, or on a phone the browser offers, named or not; and the
 * list, each removed behind a confirmation. Removing one ends every session of the member's, this one too, and revokes
 * their tokens (migration passkeys), so the page then goes to sign-in. While a passkey is being added the button is
 * marked busy rather than disabled, so keyboard focus stays on it.
 */
export const PasskeysPanel = ({ rows, text }: { rows: PasskeyRow[]; text: PasskeysText }) => {
  const router = useRouter();
  const [error, setError] = useState<AuthError>();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const statusLine = useRef<HTMLParagraphElement>(null);
  const id = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const form = event.currentTarget;
    setPending(true);
    setError(undefined);
    setStatus('');
    const failed = await addPasskey(formText(form, 'name'));
    setPending(false);
    if (failed === 'stepUp') {
      window.location.assign(confirmPath(here()));
      return;
    }
    if (failed) {
      setError(failed);
      return;
    }
    form.reset();
    setStatus(text.added);
    statusLine.current?.focus();
    router.refresh();
  };

  return (
    <>
      <h2 className={styles.h2}>{text.add}</h2>
      <form className={styles.form} onSubmit={submit} noValidate>
        <Field label={text.name} hint={text.nameHint} optional={text.optional}>
          <FieldInput
            className={styles.input}
            name="name"
            type="text"
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <FormAlert
          id={`${id}-error`}
          error={error}
          messages={text.authErrors}
          restart={text.restart}
        />
        <FormActions label={text.submit} pending={pending} status={status} statusRef={statusLine} />
      </form>
      <h2 className={styles.h2}>{text.list}</h2>
      {rows.length === 0 ? (
        <p className={styles.text}>{text.none}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{text.columns.name}</th>
                <th scope="col">{text.columns.keptIn}</th>
                <th scope="col">{text.columns.added}</th>
                <th scope="col">{text.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.keptIn}</td>
                  <td>{row.added}</td>
                  <td>
                    <ConfirmButton
                      method="POST"
                      path="/api/auth/passkey/delete-passkey"
                      body={{ id: row.id }}
                      then="/sign-in"
                      text={{
                        ...text.remove,
                        label: fill(text.remove.label, { name: row.name }),
                        errors: text.errors,
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};
