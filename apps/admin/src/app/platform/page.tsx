import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';

import { getLocale } from '@/locale';
import * as styles from '@/ui/styles';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('admin.platform.title'),
});

/** The platform's sections (§13.15): organizations for now; brand assets and sites come later (PLAN R111). */
const PlatformPage = async () => {
  const t = getTranslator(await getLocale());
  return (
    <>
      <h1 className={styles.h1}>{t('admin.platform.title')}</h1>
      <p className={styles.text}>{t('admin.platform.intro')}</p>
      <ul className={styles.list}>
        <li>
          <Link className={styles.link} href="/platform/organizations">
            {t('admin.organizations.title')}
          </Link>
        </li>
      </ul>
    </>
  );
};

export default PlatformPage;
