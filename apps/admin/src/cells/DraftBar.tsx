'use client';

import { useId, useRef, useState } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

import { useDraftEditor } from './draft-editor';
import { StaleNotice } from './StaleNotice';

/**
 * The draft's bar (admin forms §2, PLAN R190), at the bottom of the window while the draft's part of the page is in
 * view: the draft's state, whether its form holds unsaved edits (in words and a sign), "Save", which submits that form,
 * and "Send for review", which saves those edits first, so what goes to review is what is on the screen.
 */
export const DraftBar = ({
  submitPath,
  version,
  canSubmit,
  text,
}: {
  /** The draft's submit route in the API. */
  submitPath: string;
  /** The version the page loaded the cell at. */
  version: number;
  /** Whether it can be sent for review now (a draft, by an editor). */
  canSubmit: boolean;
  text: {
    title: string;
    state: string;
    unsaved: string;
    saved: string;
    save: string;
    submit: string;
    submitted: string;
    stale: string;
    reload: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const editor = useDraftEditor();
  const { pending, error, run } = useWrite();
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  const id = useId();

  const submit = async () => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setStale(false);
    try {
      let at: number | undefined = version;
      if (editor?.unsaved) {
        // Refused, the form says why at its fields.
        at = await editor.save();
      }
      if (at === undefined) {
        return;
      }
      const sentAt = at;
      const answer = await run(
        () => sendToApi('POST', submitPath, { version: sentAt }),
        () => undefined,
      );
      if (answer?.ok) {
        announce(text.submitted);
      }
      if (answer?.error === 'cellChanged') {
        setStale(true);
      }
    } finally {
      busy.current = false;
    }
  };

  const unsaved = editor?.unsaved === true;
  return (
    <div className={styles.draftBar} role="region" aria-label={text.title}>
      <p className={styles.draftBarState}>
        <span>{text.state}</span>
        <span>
          <span aria-hidden="true">{unsaved ? '✎ ' : '✓ '}</span>
          {unsaved ? text.unsaved : text.saved}
        </span>
      </p>
      <div className={styles.buttonRow}>
        <button className={styles.secondaryButton} type="submit" form="cell-form">
          {text.save}
        </button>
        {canSubmit ? (
          <button
            className={styles.button}
            type="button"
            aria-disabled={pending}
            aria-describedby={id}
            onClick={() => void submit()}
          >
            {text.submit}
          </button>
        ) : null}
      </div>
      <FormMessages id={id} error={stale ? undefined : error} status="" errors={text.errors} />
      {stale ? <StaleNotice text={text} /> : null}
    </div>
  );
};
