'use client';

import { Dialog } from '@ark-ui/react/dialog';
import { Portal } from '@ark-ui/react/portal';
import { type FormEvent, useState } from 'react';

import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Whether publishing in the election needs a second reviewer (four-eyes, editorial workflow P1): only platform admins
 * change it, audited. Turning it off asks first, and says what it means (P1.2): one person may then publish their own
 * work, which is recorded privately as self-reviewed.
 */
export const ReviewSettingForm = ({
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
    confirmTitle: string;
    confirmBody: string;
    confirm: string;
    cancel: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const [confirming, setConfirming] = useState(false);
  // What the checkbox shows: back to on if turning it off is cancelled, since nothing changed.
  const [checked, setChecked] = useState(on);
  const save = async (value: boolean) => {
    setConfirming(false);
    await run(
      () =>
        sendToApi(
          'PATCH',
          `/api/t/${encodeURIComponent(tenant)}/e/${encodeURIComponent(election)}`,
          {
            requireSecondReviewer: value,
          },
        ),
      text.saved,
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = checked;
    if (on && !value) {
      setConfirming(true);
      return;
    }
    void save(value);
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.checkboxField}>
        <input
          id="four-eyes"
          className={styles.checkbox}
          name="on"
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          aria-describedby={['four-eyes-hint', error ? 'four-eyes-error' : ''].join(' ').trim()}
        />
        <label className={styles.label} htmlFor="four-eyes">
          {text.label}
        </label>
      </div>
      <p id="four-eyes-hint" className={styles.hint}>
        {text.hint}
      </p>
      <FormMessages
        id="four-eyes-error"
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
      <Dialog.Root
        role="alertdialog"
        open={confirming}
        onOpenChange={({ open }) => {
          setConfirming(open);
          if (!open) {
            setChecked(on);
          }
        }}
      >
        <Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Positioner className={styles.dialogPositioner}>
            <Dialog.Content className={styles.dialog}>
              <Dialog.Title className={styles.dialogTitle}>{text.confirmTitle}</Dialog.Title>
              <Dialog.Description>{text.confirmBody}</Dialog.Description>
              <div className={styles.actions}>
                <Dialog.CloseTrigger className={styles.secondaryButton}>
                  {text.cancel}
                </Dialog.CloseTrigger>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    void save(false);
                  }}
                >
                  {text.confirm}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </form>
  );
};
