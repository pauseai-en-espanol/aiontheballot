import type { ReactNode } from 'react';

import * as styles from './styles';

/**
 * A part of a page that holds one form or a few that belong together (admin forms §1.4, PLAN R192): its heading, what
 * it is for, and the form. `danger` marks the block of destructive actions, which comes last on a page.
 */
export const FormSection = ({
  id,
  title,
  description,
  level = 2,
  danger = false,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  level?: 2 | 3;
  danger?: boolean;
  children: ReactNode;
}) => {
  const Heading = `h${level}` as const;
  return (
    <section
      aria-labelledby={id}
      className={danger ? `${styles.section} ${styles.dangerZone}` : styles.section}
    >
      <Heading id={id} className={level === 2 ? styles.h2 : styles.h3}>
        {title}
      </Heading>
      {description ? <p className={styles.text}>{description}</p> : null}
      {children}
    </section>
  );
};
