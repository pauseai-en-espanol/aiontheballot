'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ANNOUNCE_EVENT } from './announce';
import * as styles from './styles';

/**
 * The page's own status line (announce.ts): rendered by the tenant's layout, so it outlives the reloads of the pages
 * under it, empty until something is announced, and focused when it is. A polite live region rather than a second
 * `status` role, which the forms' own status lines already have. Each announcement empties it first and writes the
 * message on the next frame, so the same message twice is announced twice; a new page starts it empty.
 */
export const Announcer = () => {
  const [message, setMessage] = useState('');
  const line = useRef<HTMLParagraphElement>(null);
  const pathname = usePathname();
  const [page, setPage] = useState(pathname);
  if (page !== pathname) {
    setPage(pathname);
    setMessage('');
  }
  useEffect(() => {
    const listen = (event: Event) => {
      setMessage('');
      requestAnimationFrame(() => {
        setMessage((event as CustomEvent<string>).detail);
        line.current?.focus();
      });
    };
    window.addEventListener(ANNOUNCE_EVENT, listen);
    return () => window.removeEventListener(ANNOUNCE_EVENT, listen);
  }, []);
  return (
    <p
      ref={line}
      id="page-announcer"
      aria-live="polite"
      aria-atomic="true"
      tabIndex={-1}
      className={styles.status}
    >
      {message}
    </p>
  );
};
