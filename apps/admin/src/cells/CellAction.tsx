'use client';

import { useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { StaleNotice } from './StaleNotice';

/**
 * One step on a cell that needs no confirmation (submit, recall, start, remove a quote, clear a flag): a button, the
 * refusal in words if the database says no, and the stale-version notice if someone changed the cell first (C14).
 * Done, it says so in the page's own status line, since the refreshed page may no longer have this button.
 */
export const CellAction = ({
  method,
  path,
  body,
  secondary = false,
  label,
  text,
}: {
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  secondary?: boolean;
  /** The button's accessible name, when its text alone doesn't say what it acts on. */
  label?: string;
  text: {
    button: string;
    done: string;
    stale: string;
    reload: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, run } = useWrite();
  const [stale, setStale] = useState(false);
  const id = useId();
  const act = async () => {
    setStale(false);
    const answer = await run(
      () => sendToApi(method, path, body),
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.done);
    }
    if (answer?.error === 'cellChanged') {
      setStale(true);
    }
  };
  return (
    <div className={styles.form}>
      <div>
        <button
          className={secondary ? styles.secondaryButton : styles.button}
          type="button"
          aria-label={label}
          aria-disabled={pending}
          aria-describedby={id}
          onClick={() => void act()}
        >
          {text.button}
        </button>
      </div>
      <FormMessages id={id} error={stale ? undefined : error} status="" errors={text.errors} />
      {stale ? <StaleNotice text={text} /> : null}
    </div>
  );
};
