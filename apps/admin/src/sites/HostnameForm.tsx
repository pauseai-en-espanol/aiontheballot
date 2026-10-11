'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import { formText } from '@/ui/forms';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

const ERROR_ID = 'hostname-error';

/**
 * Gives a site an address (PLAN R129), marked verified: the platform sets up its DNS, route and certificate in gitops,
 * so a platform admin vouches for it. Made the main one, it takes over from the old, which then redirects to it. An
 * address is the site's for good; the database refuses one that is taken or reserved.
 */
export const HostnameForm = ({
  slug,
  text,
}: {
  slug: string;
  text: {
    label: string;
    hint: string;
    canonical: string;
    canonicalHint: string;
    add: string;
    added: string;
    errors: Record<WriteError, string>;
    constraints: Record<string, string>;
  };
}) => {
  const router = useRouter();
  const { pending, error, status, statusLine, run } = useWrite();
  const [constraint, setConstraint] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const canonical = form.elements.namedItem('canonical');
    setConstraint(undefined);
    const answer = await run(
      () =>
        sendToApi('POST', `/api/sites/${encodeURIComponent(slug)}/hostnames`, {
          hostname: formText(form, 'hostname'),
          canonical: canonical instanceof HTMLInputElement && canonical.checked,
        }),
      text.added,
    );
    if (answer && !answer.ok) {
      setConstraint(answer.constraint ?? (answer.error === 'stale' ? 'reserved' : undefined));
      return;
    }
    if (answer?.ok) {
      form.reset();
      router.refresh();
    }
  };
  const message =
    error && constraint && text.constraints[constraint] ? text.constraints[constraint] : undefined;
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="hostname">
          {text.label}
        </label>
        <p id="hostname-hint" className={styles.hint}>
          {text.hint}
        </p>
        <input
          id="hostname"
          className={styles.input}
          name="hostname"
          required
          maxLength={253}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={['hostname-hint', message ? ERROR_ID : ''].filter(Boolean).join(' ')}
        />
      </div>
      <div className={styles.checkboxField}>
        <input
          id="hostname-canonical"
          className={styles.checkbox}
          name="canonical"
          type="checkbox"
          aria-describedby="hostname-canonical-hint"
        />
        <label className={styles.label} htmlFor="hostname-canonical">
          {text.canonical}
        </label>
      </div>
      <p id="hostname-canonical-hint" className={styles.hint}>
        {text.canonicalHint}
      </p>
      <FormMessages
        id={ERROR_ID}
        statusRef={statusLine}
        error={error}
        status={message ? '' : status}
        errors={message && error ? { ...text.errors, [error]: message } : text.errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.add}
        </button>
      </div>
    </form>
  );
};
