import type { ReactNode } from 'react';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SignOutButton } from '@/auth/SignOutButton';
import { getTenant, getTenants } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { requireStage } from '@/session';
import { SectionNav } from '@/shell/SectionNav';
import { SiteSwitcher } from '@/shell/SiteSwitcher';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

/**
 * Every screen of a tenant (editorial workflow §2.1: `/t/{slug}/…`): the site's name, a switcher to the user's other
 * sites, the account, and the site's sections. A tenant the user can't open is a 404, as one that doesn't exist.
 */
const TenantLayout = async ({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant: string }>;
}) => {
  const { user } = await requireStage('signed-in');
  const { tenant: slug } = await params;
  const [overview, { tenants, platformAdmin }] = await Promise.all([getTenant(slug), getTenants()]);
  if (!overview) {
    notFound();
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  const name = siteName(overview.tenant, locale);
  const base = `/t/${overview.tenant.slug}`;
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
          <span className={styles.siteName}>
            <Lang value={name} page={locale} />
          </span>
          {tenants.length > 1 || platformAdmin ? (
            <SiteSwitcher
              current={overview.tenant.slug}
              page={locale}
              sites={tenants.map((tenant) => ({
                slug: tenant.slug,
                name: siteName(tenant, locale),
              }))}
              text={{
                switchSite: t('admin.shell.switchSite'),
                allSites: t('admin.shell.allSites'),
                current: t('admin.shell.current'),
              }}
            />
          ) : null}
        </div>
        <div className={styles.headerGroup}>
          <span className={styles.muted}>
            {t('auth.home.signedInAs', { name: user?.name ?? '' })}
          </span>
          <SignOutButton label={t('auth.home.signOut')} />
        </div>
      </header>
      <SectionNav
        label={t('admin.shell.nav')}
        sections={[
          { href: base, label: t('admin.shell.dashboard') },
          { href: `${base}/members`, label: t('admin.shell.members') },
        ]}
      />
      <main id="main" tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </>
  );
};

export default TenantLayout;
