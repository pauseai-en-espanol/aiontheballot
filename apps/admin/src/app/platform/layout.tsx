import type { ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SignOutButton } from '@/auth/SignOutButton';
import { getTenants } from '@/data';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';
import { SectionNav } from '@/shell/SectionNav';
import { Announcer } from '@/ui/Announcer';
import * as styles from '@/ui/styles';

/**
 * The platform's screens (editorial workflow §13.15, W6): what every site shares, for platform admins only. Anyone
 * else gets a 404, as for a page they can't open; the API refuses them all the same.
 */
const PlatformLayout = async ({ children }: { children: ReactNode }) => {
  const { user } = await requireStage('signed-in');
  const { platformAdmin } = await getTenants();
  if (!platformAdmin) {
    notFound();
  }
  const t = getTranslator(await getLocale());
  return (
    <>
      <a className={styles.skipLink} href="#main">
        {t('admin.skipToContent')}
      </a>
      <header className={styles.header}>
        <div className={styles.headerGroup}>
          <Link className={styles.platformLink} href="/">
            {process.env.PLATFORM_NAME}
          </Link>
          <span aria-hidden="true" className={styles.muted}>
            /
          </span>
          <span className={styles.siteName}>{t('admin.platform.title')}</span>
        </div>
        <div className={styles.headerGroup}>
          <span className={styles.muted}>
            {t('auth.home.signedInAs', { name: user?.name ?? '' })}
          </span>
          <SignOutButton label={t('auth.home.signOut')} />
        </div>
      </header>
      <SectionNav
        label={t('admin.platform.nav')}
        sections={[
          { href: '/platform', label: t('admin.platform.title') },
          { href: '/platform/organizations', label: t('admin.organizations.title') },
        ]}
      />
      <main id="main" tabIndex={-1} className={styles.main}>
        <Announcer />
        {children}
      </main>
    </>
  );
};

export default PlatformLayout;
