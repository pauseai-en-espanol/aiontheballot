'use client';

import { useState } from 'react';

import { postAuth } from './client';
import * as styles from './styles';

/** Ends the session (editorial workflow A4.4), then shows the sign-in page, whatever the API answered. */
export const SignOutButton = ({ label }: { label: string }) => {
  const [pending, setPending] = useState(false);
  return (
    <button
      className={styles.textButton}
      type="button"
      aria-disabled={pending}
      onClick={async () => {
        if (pending) {
          return;
        }
        setPending(true);
        await postAuth('/sign-out', {});
        window.location.assign('/sign-in');
      }}
    >
      {label}
    </button>
  );
};
