import Link from 'next/link';

import { type AuthError, RESTART_ERRORS } from './client';
import * as styles from './styles';

/**
 * The form's error, announced as it appears (role="alert"; the fields it concerns name it in aria-describedby), and
 * kept in words: a mark and the message, never colour alone. Rendered empty until there is one, so the live region
 * exists before its message does. When only signing in again helps, it says so with a link.
 */
export const FormAlert = ({
  id,
  error,
  messages,
  restart,
}: {
  id: string;
  error: AuthError | undefined;
  messages: Record<AuthError, string>;
  restart: string;
}) => (
  <div id={id} role="alert">
    {error ? (
      <div className={styles.alert}>
        <p>
          <span aria-hidden="true">⚠ </span>
          {messages[error]}
        </p>
        {RESTART_ERRORS.has(error) ? (
          <Link className={styles.link} href="/sign-in">
            {restart}
          </Link>
        ) : null}
      </div>
    ) : null}
  </div>
);
