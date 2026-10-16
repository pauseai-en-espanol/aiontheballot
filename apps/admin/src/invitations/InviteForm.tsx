'use client';

import { type FormEvent, useId } from 'react';

import type { TenantRole } from '@/data';

import { checkValues, type ProblemText } from '@/ui/checks';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Invites someone with a role (editorial workflow A2): the API stores the token's hash and emails the link. Inviting
 * the same address to the same role again replaces the pending invitation; someone who already holds the role is
 * refused in words, at the address (admin forms §1.2). The roles are radios with what each allows, as the roles dialog
 * says it (R182), and start on editing, never on the most powerful (admin forms §2).
 */
export const InviteForm = ({
  path,
  roles,
  text,
}: {
  /** The tenant's invitations route in the API. */
  path: string;
  /** In the order offered, each with what it allows. */
  roles: { value: TenantRole; label: string; hint: string }[];
  text: {
    email: string;
    emailHint: string;
    role: string;
    send: string;
    sent: string;
    errors: Record<WriteError, string>;
    problems: ProblemText;
  };
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<'email'>();
  const id = useId();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = formText(form, 'email').trim();
    if (
      show(checkValues({ email }, { email: { required: true, shape: 'email' } }, text.problems))
    ) {
      setError(undefined);
      return;
    }
    const answer = await run(
      () => sendToApi('POST', path, { email, role: formText(form, 'role') }),
      text.sent,
    );
    if (answer?.ok) {
      form.reset();
      return;
    }
    // About the address: someone who holds the role already, or one no account could be made for (the API's
    // `invalid`: the role is one of the radios', so it is never the one at fault).
    const problem =
      answer?.error === 'holdsRole'
        ? text.errors.holdsRole
        : answer?.error === 'invalid' || answer?.constraint === 'invitations_email_check'
          ? text.problems.email
          : undefined;
    if (problem && show({ email: problem })) {
      setError(undefined);
    }
  };
  return (
    <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
      <Field label={text.email} hint={text.emailHint} error={problems.email} required>
        <FieldInput
          className={styles.input}
          name="email"
          type="text"
          inputMode="email"
          maxLength={254}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </Field>
      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>{text.role}</legend>
        {roles.map((role) => (
          <div key={role.value} className={styles.field}>
            <span className={styles.checkboxField}>
              <input
                id={`${id}-role-${role.value}`}
                className={styles.checkbox}
                type="radio"
                name="role"
                value={role.value}
                defaultChecked={role.value === 'editor'}
                aria-describedby={`${id}-role-${role.value}-hint`}
              />
              <label className={styles.label} htmlFor={`${id}-role-${role.value}`}>
                {role.label}
              </label>
            </span>
            <span id={`${id}-role-${role.value}-hint`} className={styles.hint}>
              {role.hint}
            </span>
          </div>
        ))}
      </fieldset>
      <FormMessages id={`${id}-error`} error={error} errors={text.errors} />
      <FormActions label={text.send} pending={pending} status={status} statusRef={statusLine} />
    </form>
  );
};
