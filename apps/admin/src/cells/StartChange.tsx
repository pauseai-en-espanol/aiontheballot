'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import * as styles from '@/ui/styles';

/**
 * A published cell's editor behind an explicit step (admin forms §2, cells; PLAN R197): the cell says it is published
 * and that a change starts a draft that goes through review again; "Correct or update it" opens the editor, focus in
 * it. Until then, nothing on the page reads as a form to fill in.
 */
export const StartChange = ({
  text,
  children,
}: {
  text: { notice: string; button: string };
  children: ReactNode;
}) => {
  const [started, setStarted] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (started) {
      area.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
  }, [started]);
  return started ? (
    <div ref={area}>{children}</div>
  ) : (
    <section className={styles.notice} aria-label={text.button}>
      <p className={styles.text}>{text.notice}</p>
      <button className={styles.button} type="button" onClick={() => setStarted(true)}>
        {text.button}
      </button>
    </section>
  );
};
