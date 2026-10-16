'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import * as styles from '@/ui/styles';

export interface Section {
  href: string;
  label: string;
  /** Other path prefixes the section is current on (an election's pages, for the elections). */
  also?: string[];
}

/**
 * The tenant's sections. The one the page is in is marked for assistive technology (`aria-current`) and by shape (a
 * thick underline and bold text), never by colour alone. The dashboard is current only on itself; any other section
 * also on the pages under it. On a phone the sections are one row that scrolls sideways, the current one brought into
 * view (admin forms §1.11, PLAN R197).
 */
export const SectionNav = ({
  label,
  sections,
  variant = 'bar',
}: {
  label: string;
  sections: Section[];
  /** A bar across the page (a site's sections), or a row inside it (an election's). */
  variant?: 'bar' | 'inline';
}) => {
  const pathname = usePathname();
  const [home] = sections;
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = list.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    // Within the row only: the page itself never moves for it.
    if (row && current && row.scrollWidth > row.clientWidth) {
      row.scrollLeft = current.offsetLeft - row.offsetLeft - 16;
    }
  }, [pathname]);
  return (
    <nav className={variant === 'bar' ? styles.nav : styles.subNav} aria-label={label}>
      <ul ref={list} className={styles.navList}>
        {sections.map((section) => {
          const current =
            section === home
              ? pathname === section.href
              : pathname === section.href ||
                pathname.startsWith(`${section.href}/`) ||
                (section.also ?? []).some((prefix) => pathname.startsWith(prefix));
          return (
            <li key={section.href}>
              <Link
                className={styles.navLink}
                href={section.href}
                aria-current={current ? 'page' : undefined}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
