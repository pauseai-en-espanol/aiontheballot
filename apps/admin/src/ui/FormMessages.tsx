import type { Ref } from 'react';

import type { WriteError } from '@/write';

import * as styles from './styles';

/**
 * A form's alert and status line. Both exist before their message does, so assistive technology announces each as it
 * appears; the alert is marked in words, never by colour alone. Fields name the alert in `aria-describedby`; the
 * status line can take focus (useWrite moves it there after a change).
 */
export const FormMessages = ({
  id,
  error,
  status,
  statusRef,
  errors,
}: {
  id: string;
  error: WriteError | undefined;
  status: string;
  statusRef?: Ref<HTMLParagraphElement>;
  errors: Record<WriteError, string>;
}) => (
  <>
    <div id={id} role="alert">
      {error ? (
        <p className={styles.alert}>
          <span>
            <span aria-hidden="true">⚠ </span>
            {errors[error]}
          </span>
        </p>
      ) : null}
    </div>
    <p ref={statusRef} role="status" tabIndex={-1} className={styles.status}>
      {status}
    </p>
  </>
);
