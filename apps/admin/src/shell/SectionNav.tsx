'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import * as styles from '@/ui/styles';

export interface Section {
  href: string;
  label: string;
}

/**
 * The tenant's sections. The one the page is in is marked for assistive technology (`aria-current`) and by shape (a
 * thick underline and bold text), never by colour alone. The dashboard is current only on itself; any other section
 * also on the pages under it.
 */
export const SectionNav = ({ label, sections }: { label: string; sections: Section[] }) => {
  const pathname = usePathname();
  const [home] = sections;
  return (
    <nav className={styles.nav} aria-label={label}>
      <ul className={styles.navList}>
        {sections.map((section) => {
          const current =
            section === home
              ? pathname === section.href
              : pathname === section.href || pathname.startsWith(`${section.href}/`);
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
