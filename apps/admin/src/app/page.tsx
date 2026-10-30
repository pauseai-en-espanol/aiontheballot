import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/auth/SignOutButton';
import { getTenants } from '@/data';
import { getLocale } from '@/locale';
import { siteName } from '@/localized';
import { requireStage } from '@/session';
import { Lang } from '@/ui/Lang';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.home.title'),
});

/**
 * Where signing in ends (editorial workflow A6.1): a member of one site goes straight to its dashboard; a member of
 * several, or a platform admin, chooses from the sites they may open. Platform admins also find the platform's screens.
 */
const Home = async () => {
  const { user } = await requireStage('signed-in');
  const { tenants, platformAdmin } = await getTenants();
  const [only] = tenants;
  if (only && tenants.length === 1 && !platformAdmin) {
    redirect(`/t/${only.slug}`);
  }
  const locale = await getLocale();
  const t = getTranslator(locale);
  return (
    <main className={styles.narrow}>
      <h1 className={styles.h1}>{t('auth.home.title')}</h1>
      <p className={styles.text}>{t('auth.home.signedInAs', { name: user?.name ?? '' })}</p>
      {platformAdmin ? <p className={styles.text}>{t('admin.sites.platformAdmin')}</p> : null}
      {tenants.length === 0 ? (
        <p className={styles.text}>{t('auth.home.noTenants')}</p>
      ) : (
        <ul className={styles.list}>
          {tenants.map((tenant) => (
            <li key={tenant.slug}>
              <Link className={styles.link} href={`/t/${tenant.slug}`}>
                <Lang value={siteName(tenant, locale)} page={locale} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {platformAdmin ? (
        <>
          <h2 className={styles.h2}>{t('admin.platform.title')}</h2>
          <ul className={styles.list}>
            <li>
              <Link className={styles.link} href="/platform/organizations">
                {t('admin.organizations.title')}
              </Link>
            </li>
          </ul>
        </>
      ) : null}
      <p className={styles.text}>
        <Link className={styles.link} href="/tokens">
          {t('admin.tokens.navLink')}
        </Link>
      </p>
      <p className={styles.text}>
        <Link className={styles.link} href="/passkeys">
          {t('admin.passkeys.navLink')}
        </Link>
      </p>
      <SignOutButton label={t('auth.home.signOut')} />
    </main>
  );
};

export default Home;
