'use client';

import type { FormEvent } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

const settingsPath = (tenant: string) => `/api/t/${encodeURIComponent(tenant)}/settings`;

/**
 * How long reports are kept before they are anonymized (editorial workflow T3): country admins and platform admins
 * change it; the database decides. A change applies to reports sent from then on, which the hint says.
 */
export const RetentionForm = ({
  tenant,
  days,
  text,
}: {
  tenant: string;
  days: number;
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
    const value = Number(new FormData(event.currentTarget).get('days'));
    await run(
      () => sendToApi('PATCH', settingsPath(tenant), { reportRetentionDays: value }),
      text.saved,
    );
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="retention-days">
          {text.label}
        </label>
        <p id="retention-hint" className={styles.hint}>
          {text.hint}
        </p>
        <input
          id="retention-days"
          className={styles.numberInput}
          name="days"
          type="number"
          inputMode="numeric"
          min={1}
          max={36_500}
          step={1}
          required
          defaultValue={days}
          aria-invalid={error === 'invalid' || error === 'incomplete' ? true : undefined}
          aria-describedby={['retention-hint', error ? 'retention-error' : ''].join(' ').trim()}
        />
      </div>
      <FormMessages
        id={'retention-error'}
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

/**
 * Whether a second person must approve changes to a live election (editorial workflow P1): only platform admins
 * change it, audited; the database refuses anyone else.
 */
export const LiveEditsForm = ({
  tenant,
  on,
  text,
}: {
  tenant: string;
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
    const value = new FormData(event.currentTarget).get('on') === 'on';
    await run(
      () => sendToApi('PATCH', settingsPath(tenant), { liveEditsNeedSecondApprover: value }),
      text.saved,
    );
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.checkboxField}>
        <input
          id="live-edits"
          className={styles.checkbox}
          name="on"
          type="checkbox"
          defaultChecked={on}
          aria-describedby={['live-edits-hint', error ? 'live-edits-error' : ''].join(' ').trim()}
        />
        <label className={styles.label} htmlFor="live-edits">
          {text.label}
        </label>
      </div>
      <p id="live-edits-hint" className={styles.hint}>
        {text.hint}
      </p>
      <FormMessages
        id={'live-edits-error'}
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
