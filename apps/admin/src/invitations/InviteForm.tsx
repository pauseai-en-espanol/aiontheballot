'use client';

import { type FormEvent, useId } from 'react';

import type { TenantRole } from '@/data';

import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Invites someone with a role (editorial workflow A2): the API stores the token's hash and emails the link. Inviting
 * the same address to the same role again replaces the pending invitation; someone who already holds the role is
 * refused in words.
 */
export const InviteForm = ({
  path,
  roles,
  text,
}: {
  /** The tenant's invitations route in the API. */
  path: string;
  roles: { value: TenantRole; label: string }[];
  text: {
    email: string;
    emailHint: string;
    role: string;
    send: string;
    sent: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const answer = await run(
      () =>
        sendToApi('POST', path, { email: formText(form, 'email'), role: formText(form, 'role') }),
      text.sent,
    );
    if (answer?.ok) {
      form.reset();
    }
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-email`}>
          {text.email}
        </label>
        <p id={`${id}-hint`} className={styles.hint}>
          {text.emailHint}
        </p>
        <input
          id={`${id}-email`}
          className={styles.input}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={[`${id}-hint`, error ? `${id}-error` : ''].filter(Boolean).join(' ')}
          aria-invalid={error === 'holdsRole' || error === 'invalid' ? true : undefined}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-role`}>
          {text.role}
        </label>
        <select id={`${id}-role`} className={styles.select} name="role" required>
          {roles.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>
      </div>
      <FormMessages
        id={`${id}-error`}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.send}
        </button>
      </div>
    </form>
  );
};
