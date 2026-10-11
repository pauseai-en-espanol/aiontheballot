import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';

import { SignOutButton } from '@/auth/SignOutButton';
import * as styles from '@/auth/styles';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';
import { listTenants, tenantName } from '@/tenants';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.home.title'),
});

// Signed in with a second factor: the tenants this user may open (editorial workflow A6).
const Home = async () => {
  const { user } = await requireStage('signed-in');
  const locale = await getLocale();
  const t = getTranslator(locale);
  const tenants = await listTenants();
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.home.title')}</h1>
      <p className={styles.text}>{t('auth.home.signedInAs', { name: user?.name ?? '' })}</p>
      {tenants.length === 0 ? (
        <p className={styles.text}>{t('auth.home.noTenants')}</p>
      ) : (
        <ul className={styles.list}>
          {tenants.map((tenant) => (
            <li key={tenant.slug}>{tenantName(tenant, locale)}</li>
          ))}
        </ul>
      )}
      <SignOutButton label={t('auth.home.signOut')} />
    </main>
  );
};

export default Home;
