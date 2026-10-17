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
 * announced). Once done, the page goes to `then` and says `done` there, or reloads its data and announces `done` in the
 * status line, which takes focus, since the button may be gone. A refusal shows in the alert, which the button names.
 * With `typeToConfirm`, the dialog also asks for a name typed, as going live does (PLAN R193, R212).
 */
export const ConfirmButton = ({
  method,
  path,
  body,
  then,
  removes = false,
  typeToConfirm,
  text,
  secondary = true,
}: {
  method: 'DELETE' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: Record<string, unknown>;
  /**
   * The name to type before acting, shown as code where `label` says `{slug}`; what was typed is sent as the body's
   * `confirmation`, which the API checks again.
   */
  typeToConfirm?: { slug: string; label: string; mismatch: string };
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
  const trigger = useRef<HTMLButtonElement>(null);
  const focusStatus = useRef(false);
  // Whether the dialog closed on Confirm: after Cancel, focus goes back to the button, whatever `removes` says.
  const confirmed = useRef(false);
  const errorId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState('');
  const [mismatch, setMismatch] = useState(false);

  // The dialog closes before the write, so what follows is announced outside it, and hands focus to the status line,
  // since the button may be gone afterwards (after Cancel, it goes back to the button).
  const act = async () => {
    if (busy.current) {
      return;
    }
    if (typeToConfirm && typed.trim() !== typeToConfirm.slug) {
      setMismatch(true);
      return;
    }
    focusStatus.current = then === undefined && !removes;
    confirmed.current = true;
    setOpen(false);
    busy.current = true;
    setPending(true);
    setError(undefined);
    setStatus('');
    const answer = await sendToApi(
      method,
      path,
      typeToConfirm ? { ...body, confirmation: typed.trim() } : body,
    );
    busy.current = false;
    setPending(false);
    if (!answer.ok) {
      setError(answer.error ?? 'unexpected');
      // Back to the button, which names the alert, once it is rendered: not the empty status line.
      requestAnimationFrame(() => trigger.current?.focus());
      return;
    }
    if (then !== undefined) {
      // Said where it lands (admin forms §1.4), as the page this was on is gone.
      if (text.done !== '') {
        announce(text.done, { afterNavigation: true });
      }
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
        ref={trigger}
        className={secondary ? styles.secondaryButton : styles.button}
        type="button"
        aria-label={text.label}
        aria-describedby={error ? errorId : undefined}
        aria-disabled={pending}
        onClick={() => {
          setError(undefined);
          focusStatus.current = false;
          confirmed.current = false;
          setTyped('');
          setMismatch(false);
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
            : removes && confirmed.current
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
              {typeToConfirm ? (
                <>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={inputId}>
                      {typeToConfirm.label.split('{slug}').map((part, index) =>
                        index === 0 ? (
                          part
                        ) : (
                          <span key={part}>
                            <code className={styles.copyableCode}>{typeToConfirm.slug}</code>
                            {part}
                          </span>
                        ),
                      )}
                    </label>
                    <input
                      id={inputId}
                      className={styles.input}
                      value={typed}
                      onChange={(event) => {
                        setTyped(event.target.value);
                        setMismatch(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void act();
                        }
                      }}
                      aria-invalid={mismatch ? true : undefined}
                      aria-describedby={`${inputId}-mismatch`}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </div>
                  <p id={`${inputId}-mismatch`} role="alert" className={styles.hint}>
                    {mismatch ? typeToConfirm.mismatch : null}
                  </p>
                </>
              ) : null}
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
