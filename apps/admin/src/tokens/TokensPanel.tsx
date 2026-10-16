'use client';

import { type FormEvent, useId, useRef, useState } from 'react';

import { fill } from '@/fill';
import { ConfirmButton } from '@/ui/ConfirmButton';
import { Field, FieldInput } from '@/ui/Field';
import { FormActions } from '@/ui/FormActions';
import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useProblems } from '@/ui/useProblems';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface TokenRow {
  id: string;
  name: string;
  /** As the page's language writes them. */
  created: string;
  expires: string;
  lastUsed: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface TokensText {
  create: string;
  name: string;
  nameHint: string;
  days: string;
  /** With `{max}`. */
  daysHint: string;
  submit: string;
  created: string;
  yours: string;
  copy: string;
  copied: string;
  list: string;
  none: string;
  columns: Record<'name' | 'created' | 'expires' | 'lastUsed' | 'status' | 'actions', string>;
  status: Record<TokenRow['status'], string>;
  revoke: {
    button: string;
    /** With `{name}`. */
    label: string;
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    done: string;
  };
  required: string;
  errors: Record<WriteError, string>;
}

/**
 * A member's tokens for tools (ADR-0008, PLAN R203): a new one minted with what it's for and how many days it lasts,
 * then shown once, to copy, in a read-only field the page focuses; and the list, each active one revoked behind a
 * confirmation. The token is in this component's state only, never in the page's data, and goes with the page.
 */
export const TokensPanel = ({
  rows,
  maxDays,
  text,
}: {
  rows: TokenRow[];
  maxDays: number;
  text: TokensText;
}) => {
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const { problems, show, form: formRef } = useProblems<'name'>();
  const [token, setToken] = useState<string>();
  const [copied, setCopied] = useState(false);
  const shown = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = formText(form, 'name').trim();
    if (show(name === '' ? { name: text.required } : {})) {
      setError(undefined);
      return;
    }
    const days = Number(formText(form, 'days'));
    setToken(undefined);
    setCopied(false);
    const answer = await run(() => sendToApi('POST', '/api/tokens', { name, days }), text.created, {
      focus: false,
    });
    if (answer?.ok) {
      const body = answer.body as { token?: unknown };
      if (typeof body.token === 'string') {
        setToken(body.token);
        form.reset();
        // The token, selected, so it can be copied at once; the status line has said it is shown only now.
        requestAnimationFrame(() => shown.current?.select());
      }
    }
  };

  const copy = async () => {
    if (token) {
      try {
        await navigator.clipboard.writeText(token);
        setCopied(true);
      } catch {
        shown.current?.select();
      }
    }
  };

  return (
    <>
      <h2 className={styles.h2}>{text.create}</h2>
      <form ref={formRef} className={styles.form} onSubmit={submit} noValidate>
        <Field label={text.name} hint={text.nameHint} error={problems.name} required>
          <FieldInput
            className={styles.input}
            name="name"
            type="text"
            maxLength={80}
            autoComplete="off"
          />
        </Field>
        <Field label={text.days} hint={fill(text.daysHint, { max: String(maxDays) })} required>
          <FieldInput
            className={styles.input}
            name="days"
            type="number"
            inputMode="numeric"
            min={1}
            max={maxDays}
            defaultValue={maxDays}
          />
        </Field>
        <FormMessages id={`${id}-error`} error={error} errors={text.errors} />
        <FormActions label={text.submit} pending={pending} status={status} statusRef={statusLine} />
      </form>
      {token ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-token`}>
            {text.yours}
          </label>
          <input
            ref={shown}
            id={`${id}-token`}
            className={styles.input}
            type="text"
            readOnly
            value={token}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className={styles.secondaryButton} onClick={copy}>
            {text.copy}
          </button>
          <p role="status" className={styles.hint}>
            {copied ? text.copied : ''}
          </p>
        </div>
      ) : null}
      <h2 className={styles.h2}>{text.list}</h2>
      {rows.length === 0 ? (
        <p className={styles.text}>{text.none}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{text.columns.name}</th>
                <th scope="col">{text.columns.created}</th>
                <th scope="col">{text.columns.expires}</th>
                <th scope="col">{text.columns.lastUsed}</th>
                <th scope="col">{text.columns.status}</th>
                <th scope="col">{text.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.name}</th>
                  <td>{row.created}</td>
                  <td>{row.expires}</td>
                  <td>{row.lastUsed}</td>
                  <td>{text.status[row.status]}</td>
                  <td>
                    {row.status === 'active' ? (
                      <ConfirmButton
                        method="DELETE"
                        path={`/api/tokens/${row.id}`}
                        removes
                        text={{
                          ...text.revoke,
                          label: fill(text.revoke.label, { name: row.name }),
                          errors: text.errors,
                        }}
                      />
                    ) : null}
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
