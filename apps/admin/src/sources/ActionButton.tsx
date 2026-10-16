'use client';

import { useId } from 'react';

import { announce } from '@/ui/announce';
import { FormMessages } from '@/ui/FormMessages';
import * as styles from '@/ui/styles';
import { useWrite } from '@/ui/useWrite';
import { sendToApi, type WriteError } from '@/write';

/**
 * A source's action that posts to the API and reloads the page's data to show what changed: asking the worker again
 * for its text (S3), e.g. after it was away when the copy was stored; fetching its copy from its URL (S2.1); asking for
 * a snapshot of its URL (S4). Nothing changes if the job finished meanwhile.
 */
export const ActionButton = ({
  path,
  text,
}: {
  path: string;
  text: { button: string; done: string; errors: Record<WriteError, string> };
}) => {
  const { pending, error, run } = useWrite();
  const id = useId();
  const act = async () => {
    const answer = await run(
      () => sendToApi('POST', path),
      () => undefined,
    );
    if (answer?.ok) {
      announce(text.done);
    }
  };
  return (
    <div className={styles.form}>
      <div>
        <button
          className={styles.secondaryButton}
          type="button"
          aria-disabled={pending}
          aria-describedby={error ? id : undefined}
          onClick={() => void act()}
        >
          {text.button}
        </button>
      </div>
      <FormMessages id={id} error={error} status="" errors={text.errors} />
    </div>
  );
};
