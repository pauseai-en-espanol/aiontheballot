'use client';

import type { FormEvent } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Whether a draft election is announced, so the site's coming-soon page gives its name and date (PLAN R51): country
 * admins and platform admins, while it is a draft; it needs its name in the default language (the database's rule).
 */
export const AnnounceForm = ({
  tenant,
  election,
  on,
  text,
}: {
  tenant: string;
  election: string;
  on: boolean;
  text: {
    label: string;
    hint: string;
    save: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const announced = new FormData(event.currentTarget).get('announced') === 'on';
    await run(
      () =>
        sendToApi(
          'PATCH',
          `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election)}`,
          {
            announced,
          },
        ),
      text.saved,
    );
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.checkboxField}>
        <input
          id="announced"
          className={styles.checkbox}
          name="announced"
          type="checkbox"
          defaultChecked={on}
          aria-describedby={['announced-hint', error ? 'announced-error' : ''].join(' ').trim()}
        />
        <label className={styles.label} htmlFor="announced">
          {text.label}
        </label>
      </div>
      <p id="announced-hint" className={styles.hint}>
        {text.hint}
      </p>
      <FormMessages
        id="announced-error"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <div>
        <button className={styles.button} type="submit" aria-disabled={pending}>
          {text.save}
        </button>
      </div>
    </form>
  );
};
