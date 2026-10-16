'use client';

import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * Records a check of a party's programme (editorial workflow PS1): either button sets the status, even to the one it
 * had, and the database stamps the check's date, which the public sees. "Published" needs a source marked as the
 * party's programme; without one its button says why and sends nothing (the database would refuse it too).
 */
export const ProgrammeForm = ({
  path,
  canPublish,
  text,
}: {
  /** The party's programme route in the API. */
  path: string;
  canPublish: boolean;
  text: {
    checkPending: string;
    checkPublished: string;
    needsSource: string;
    saved: string;
    errors: Record<WriteError, string>;
  };
}) => {
  const { pending, error, status, statusLine, run } = useWrite();
  const check = (value: 'pending' | 'published') => {
    if (value === 'published' && !canPublish) {
      return;
    }
    void run(() => sendToApi('PUT', path, { status: value }), text.saved);
  };
  return (
    <div className={styles.form}>
      <div className={styles.actions}>
        <button
          className={styles.button}
          type="button"
          aria-disabled={pending}
          aria-describedby="programme-messages"
          onClick={() => check('pending')}
        >
          {text.checkPending}
        </button>
        <button
          className={styles.secondaryButton}
          type="button"
          aria-disabled={pending || !canPublish}
          aria-describedby={canPublish ? 'programme-messages' : 'programme-needs-source'}
          onClick={() => check('published')}
        >
          {text.checkPublished}
        </button>
      </div>
      {!canPublish && (
        <p id="programme-needs-source" className={styles.hint}>
          {text.needsSource}
        </p>
      )}
      <FormMessages
        id="programme-messages"
        error={error}
        status={status}
        statusRef={statusLine}
        errors={text.errors}
      />
    </div>
  );
};
