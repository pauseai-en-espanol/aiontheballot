'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useId, useState } from 'react';

import type { WriteAnswer, WriteError } from '@/write';

import { FormMessages } from './FormMessages';
import * as styles from './styles';
import { useWrite } from './useWrite';

/**
 * A setting that saves as it is switched (admin forms §2, elections; PLAN R193): a switch with its label, its state in
 * words ("On", "Off") and a sign, never by colour alone, its hint, and "Saved." beside it. Turning it off can ask first
 * (`confirmOff`); cancelling leaves it as it was, and so does a refusal, said at the switch (`refused` names one the
 * form knows) or in its alert.
 */
export const SwitchField = ({
  label,
  hint,
  on,
  save,
  refused,
  confirmOff,
  text,
}: {
  label: string;
  hint?: string;
  on: boolean;
  /** Sends the new value. */
  save: (value: boolean) => Promise<WriteAnswer>;
  /** What to say at the switch for a refusal it is about. */
  refused?: (answer: WriteAnswer) => string | undefined;
  confirmOff?: { title: string; body: string; confirm: string; cancel: string };
  text: { on: string; off: string; saved: string; errors: Record<WriteError, string> };
}) => {
  const id = useId();
  const { pending, error, status, statusLine, run, setError } = useWrite();
  const [checked, setChecked] = useState(on);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string>();

  const commit = async (value: boolean) => {
    setConfirming(false);
    setProblem(undefined);
    setChecked(value);
    // Focus stays on the switch: its state and "Saved." are announced from where they are.
    const answer = await run(() => save(value), text.saved, { focus: false });
    if (answer && !answer.ok) {
      setChecked(!value);
      const said = refused?.(answer);
      if (said !== undefined) {
        setError(undefined);
        setProblem(said);
      }
    }
  };

  const toggle = () => {
    if (pending) {
      return;
    }
    const next = !checked;
    if (!next && confirmOff) {
      setConfirming(true);
      return;
    }
    void commit(next);
  };

  return (
    <div className={styles.field}>
      <div className={styles.switchRow}>
        <button
          id={id}
          className={styles.switchControl}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-labelledby={`${id}-label`}
          aria-describedby={[
            hint ? `${id}-hint` : '',
            problem ? `${id}-problem` : '',
            error ? `${id}-error` : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-invalid={problem ? true : undefined}
          onClick={toggle}
        >
          <span
            className={styles.switchTrack}
            data-on={checked ? '' : undefined}
            aria-hidden="true"
          >
            <span className={styles.switchThumb} />
          </span>
          <span className={styles.switchState}>
            <span aria-hidden="true">{checked ? '✓ ' : '✗ '}</span>
            {checked ? text.on : text.off}
          </span>
        </button>
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
        <p ref={statusLine} role="status" tabIndex={-1} className={styles.status}>
          {status}
        </p>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={`${id}-problem`} className={styles.fieldError}>
          <span aria-hidden="true">⚠</span>
          <span>{problem}</span>
        </p>
      ) : null}
      <FormMessages id={`${id}-error`} error={error} errors={text.errors} />
      {confirmOff ? (
        <Dialog.Root
          role="alertdialog"
          open={confirming}
          onOpenChange={({ open }) => setConfirming(open)}
        >
          <Portal>
            <Dialog.Backdrop className={styles.backdrop} />
            <Dialog.Positioner className={styles.dialogPositioner}>
              <Dialog.Content className={styles.dialog}>
                <Dialog.Title className={styles.dialogTitle}>{confirmOff.title}</Dialog.Title>
                <Dialog.Description>{confirmOff.body}</Dialog.Description>
                <div className={styles.actions}>
                  <Dialog.CloseTrigger className={styles.secondaryButton}>
                    {confirmOff.cancel}
                  </Dialog.CloseTrigger>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => void commit(false)}
                  >
                    {confirmOff.confirm}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
};
