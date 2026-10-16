'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import Link from 'next/link';
import { useId, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

export interface ChecklistItem {
  label: string;
  done: boolean;
  /** Where what is missing is done (admin forms §2, elections; PLAN R193). */
  href?: string;
}

/**
 * Going live (editorial workflow E5), or into preview first (PLAN R181), or archiving (E7): the checklist of what the
 * database will require, each item marked done or missing in words and with a sign, never by colour alone, and a
 * missing one linked to where it is done; the warnings that don't block; and, once nothing is missing, the button. No
 * step can be undone; going live, which makes the election public, and archiving ask for the election's slug, typed
 * (E5.4; PLAN R193), shown as code; the preview only for a confirmation. The database checks everything again when the
 * status changes.
 */
export const GoLivePanel = ({
  path,
  slug,
  to = 'live',
  needs,
  warnings,
  text,
}: {
  path: string;
  slug: string;
  /** The status it moves the election to. */
  to?: 'preview' | 'live' | 'archived';
  needs: ChecklistItem[];
  warnings: string[];
  text: {
    needsTitle: string;
    warningsTitle: string;
    done: string;
    missing: string;
    button: string;
    notReady: string;
    confirmTitle: string;
    confirmBody: string;
    /** With `{slug}`, which is shown as code; without it, the dialog asks only to confirm. */
    typeSlug?: string;
    confirm: string;
    cancel: string;
    wentLive: string;
    /** When what was typed isn't the slug. */
    slugMismatch?: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const ready = needs.every((item) => item.done);
  const matches = text.typeSlug === undefined || typed.trim() === slug;

  const [mismatch, setMismatch] = useState(false);
  const goLive = () => {
    if (!matches) {
      setMismatch(true);
      return;
    }
    setOpen(false);
    // This panel goes once the status changes: the page's own status line says so.
    void run(
      () => sendToApi('PATCH', path, { status: to }),
      () => undefined,
    ).then((answer) => {
      if (answer?.ok) {
        announce(text.wentLive);
      }
    });
  };

  return (
    <div className={styles.form}>
      {needs.length > 0 ? (
        <>
          <h3 className={styles.h3}>{text.needsTitle}</h3>
          <ul className={styles.checklist}>
            {needs.map((item) => (
              <li
                key={item.label}
                className={styles.checkItem}
                data-done={item.done ? '' : undefined}
              >
                <span aria-hidden="true">{item.done ? '✓' : '✗'}</span>
                <span>
                  <span className={styles.visuallyHidden}>
                    {item.done ? text.done : text.missing}:{' '}
                  </span>
                  {!item.done && item.href ? (
                    <Link className={styles.link} href={item.href}>
                      {item.label}
                    </Link>
                  ) : (
                    item.label
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {warnings.length > 0 ? (
        <>
          <h3 className={styles.h3}>{text.warningsTitle}</h3>
          <ul className={styles.checklist}>
            {warnings.map((warning) => (
              <li key={warning} className={styles.checkItem}>
                <span aria-hidden="true">⚠</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <FormMessages
        id="go-live-error"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
      {ready ? (
        <div>
          <button
            className={styles.button}
            type="button"
            aria-disabled={pending}
            onClick={() => {
              setTyped('');
              setOpen(true);
            }}
          >
            {text.button}
          </button>
        </div>
      ) : (
        <p className={styles.hint}>{text.notReady}</p>
      )}
      <Dialog.Root role="alertdialog" open={open} onOpenChange={({ open: next }) => setOpen(next)}>
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>{text.confirmTitle}</Dialog.Title>
              <Dialog.Description>{text.confirmBody}</Dialog.Description>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  goLive();
                }}
              >
                {text.typeSlug === undefined ? null : (
                  <>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={inputId}>
                        {text.typeSlug.split('{slug}').map((part, index) =>
                          index === 0 ? (
                            part
                          ) : (
                            <span key={part}>
                              <code className={styles.copyableCode}>{slug}</code>
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
                        aria-invalid={mismatch ? true : undefined}
                        aria-describedby={`${inputId}-mismatch`}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                      />
                    </div>
                    <p id={`${inputId}-mismatch`} role="alert" className={styles.hint}>
                      {mismatch ? text.slugMismatch : null}
                    </p>
                  </>
                )}
                <div className={styles.actions}>
                  <Dialog.CloseTrigger className={styles.secondaryButton} type="button">
                    {text.cancel}
                  </Dialog.CloseTrigger>
                  <button className={styles.button} type="submit" aria-disabled={!matches}>
                    {text.confirm}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </div>
  );
};
