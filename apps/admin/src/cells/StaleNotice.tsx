'use client';

import * as styles from '@/ui/styles';

/**
 * Someone changed the cell since it was loaded (editorial workflow C14): nothing was saved, and a reload shows their
 * change. A full reload, so every field shows what is stored now rather than what was typed.
 */
export const StaleNotice = ({ text }: { text: { stale: string; reload: string } }) => (
  <div role="alert" className={styles.notice}>
    <p>{text.stale}</p>
    <button
      className={styles.secondaryButton}
      type="button"
      onClick={() => window.location.reload()}
    >
      {text.reload}
    </button>
  </div>
);
