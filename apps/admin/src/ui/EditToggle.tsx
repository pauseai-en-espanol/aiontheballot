'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import * as styles from './styles';

/**
 * One view of a record's details (admin forms §2, sources; PLAN R194): its facts and an "Edit" button; pressed, the
 * form takes their place, its first field focused, with "Stop editing", which brings the facts back and focus to
 * "Edit". The page reloads its data after a save, so the facts are current when they come back.
 */
export const EditToggle = ({
  view,
  form,
  text,
}: {
  view: ReactNode;
  form: ReactNode;
  text: { edit: string; stop: string };
}) => {
  const [editing, setEditing] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) {
      return;
    }
    moved.current = false;
    if (editing) {
      area.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
    } else {
      edit.current?.focus();
    }
  }, [editing]);
  const toggle = (next: boolean) => {
    moved.current = true;
    setEditing(next);
  };
  return editing ? (
    <div ref={area}>
      {form}
      <button className={styles.secondaryButton} type="button" onClick={() => toggle(false)}>
        {text.stop}
      </button>
    </div>
  ) : (
    <>
      {view}
      <button
        ref={edit}
        className={styles.secondaryButton}
        type="button"
        onClick={() => toggle(true)}
      >
        {text.edit}
      </button>
    </>
  );
};
