'use client';

import * as styles from '@/ui/styles';

import { useDraftEditor } from './draft-editor';

/** Beside what submitting needs: that the draft's form holds edits the list doesn't count yet (PLAN R190). */
export const UnsavedHint = ({ text }: { text: string }) =>
  useDraftEditor()?.unsaved ? (
    <p className={styles.notice}>
      <span aria-hidden="true">✎ </span>
      {text}
    </p>
  ) : null;
