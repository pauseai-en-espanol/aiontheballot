import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';

import { getLocale } from '@/locale';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.notFound.title'),
});

/** Any page that doesn't exist, and any tenant or election the user can't open (editorial workflow §2.1). */
const NotFound = async () => {
  const t = getTranslator(await getLocale());
  return (
    <main className={styles.narrow}>
      <h1 className={styles.h1}>{t('admin.notFound.title')}</h1>
      <p className={styles.text}>{t('admin.notFound.body')}</p>
      <Link className={styles.link} href="/">
        {t('admin.notFound.home')}
      </Link>
    </main>
  );
};

export default NotFound;
