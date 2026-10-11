'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import { sendToApi, type WriteError } from '@/write';

import * as styles from './styles';

/**
 * An action that can't be undone, such as a delete, behind a confirmation (an alert dialog, so keyboard-complete and
 * announced). Once done, the page goes to `then`, or reloads its data and announces `done` in the status line, which
 * takes focus, since the button may be gone. A refusal shows in the alert, which the button names.
 */
export const ConfirmButton = ({
  method,
  path,
  body,
  then,
  removes = false,
  text,
  secondary = true,
}: {
  method: 'DELETE' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
  /** Where to go once done; without it, the page stays and reloads its data. */
  then?: string;
  /** Whether the button goes with what it removes, so the page's announcer says it's done (announce.ts). */
  removes?: boolean;
  text: {
    button: string;
    /** The button's accessible name, when its text alone doesn't say what it acts on. */
    label?: string;
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    done: string;
    errors: Record<WriteError, string>;
  };
  secondary?: boolean;
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<WriteError>();
  const [status, setStatus] = useState('');
  const busy = useRef(false);
  const statusLine = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const errorId = useId();

  // The dialog closes before the write, so what follows is announced outside it, and hands focus to the status line,
  // since the button may be gone afterwards (after Cancel, it goes back to the button).
  const act = async () => {
    if (busy.current) {
      return;
    }
    focusStatus.current = then === undefined && !removes;
    setOpen(false);
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    const answer = await sendToApi(method, path, body);
    busy.current = false;
    setPending(false);
    if (!answer.ok) {
      setError(answer.error ?? 'unexpected');
      return;
    }
    if (then !== undefined) {
      router.push(then);
      return;
    }
    if (removes) {
      announce(text.done);
    } else {
      setStatus(text.done);
      statusLine.current?.focus();
    }
    router.refresh();
  };

  return (
    <div className={styles.confirm}>
      <button
        className={secondary ? styles.secondaryButton : styles.button}
        type="button"
        aria-label={text.label}
        aria-describedby={error ? errorId : undefined}
        aria-disabled={pending}
        onClick={() => {
          setError(undefined);
          focusStatus.current = false;
          setOpen(true);
        }}
      >
        {text.button}
      </button>
      <FormMessages
        id={errorId}
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      <Dialog.Root
        role="alertdialog"
        open={open}
        onOpenChange={({ open: next }) => setOpen(next)}
        finalFocusEl={() =>
          focusStatus.current
            ? statusLine.current
            : removes
              ? document.getElementById('page-announcer')
              : null
        }
      >
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>{text.title}</Dialog.Title>
              <Dialog.Description>{text.body}</Dialog.Description>
              <div className={styles.actions}>
                <Dialog.CloseTrigger className={styles.secondaryButton}>
                  {text.cancel}
                </Dialog.CloseTrigger>
                <button
                  className={styles.button}
                  type="button"
                  aria-disabled={pending}
                  onClick={() => void act()}
                >
                  {text.confirm}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
};
