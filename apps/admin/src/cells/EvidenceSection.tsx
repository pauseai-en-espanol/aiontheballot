'use client';

import type { ReactNode } from 'react';

import * as styles from '@/ui/styles';

import type { Rating } from './data';

import { useDraftEditor } from './draft-editor';

/**
 * One kind of a draft's evidence (editorial workflow C2, C3; PLAN R230), shown as the rating the form shows needs it,
 * saved or not: quotes for a rating the programme backs or contradicts, the documents checked for "not mentioned". With
 * no rating chosen yet, quotes show, and checked documents only if there are some. Evidence the rating doesn't take
 * shows while there is some, with a warning, so it can be removed: the database refuses neither, and both would be
 * published with the cell.
 */
export const EvidenceSection = ({
  id,
  title,
  kind,
  count,
  rating: saved,
  mismatch,
  children,
}: {
  id: string;
  title: string;
  kind: 'quotes' | 'checked';
  /** How many of this kind the draft has. */
  count: number;
  /** The saved rating, for a page whose draft isn't edited here. */
  rating: Rating | null;
  /** Said when the rating doesn't take this kind but the draft has some. */
  mismatch: string;
  children: ReactNode;
}) => {
  const editor = useDraftEditor();
  const rating = editor ? editor.rating : saved;
  const takes = kind === 'checked' ? rating === 'not_mentioned' : rating !== 'not_mentioned';
  if (!takes && count === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className={styles.section}>
      <h3 id={id} className={styles.h3}>
        {title}
      </h3>
      {!takes && rating !== null ? (
        <p className={styles.notice}>
          <span aria-hidden="true">⚠ </span>
          {mismatch}
        </p>
      ) : null}
      {children}
    </section>
  );
};
