import type { ReactNode, Ref } from 'react';

import * as styles from './styles';

/**
 * A form's actions (admin forms §1.4, PLAN R192): its one primary button at the start of the line, anything else after
 * it, and what the form just did ("Saved.") beside the button, in a status line that can take focus.
 */
export const FormActions = ({
  label,
  buttonLabel,
  pending,
  status,
  statusRef,
  children,
}: {
  label: string;
  /** The button's accessible name, when several such forms are on a page ("Save {name}"). */
  buttonLabel?: string | undefined;
  pending: boolean;
  status?: string;
  statusRef?: Ref<HTMLParagraphElement>;
  children?: ReactNode;
}) => (
  <div className={styles.formActions}>
    <button
      className={styles.button}
      type="submit"
      aria-label={buttonLabel}
      aria-disabled={pending}
    >
      {label}
    </button>
    {children}
    {status === undefined ? null : (
      <p ref={statusRef} role="status" tabIndex={-1} className={styles.status}>
        {status}
      </p>
    )}
  </div>
);
