import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';

import { EnrolForm } from '@/auth/EnrolForm';
import { SignOutButton } from '@/auth/SignOutButton';
import * as styles from '@/auth/styles';
import { authErrors } from '@/auth/text';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.enrol.title'),
});

const EnrolPage = async () => {
  await requireStage('enrol');
  const t = getTranslator(await getLocale());
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.enrol.title')}</h1>
      <p className={styles.text}>{t('auth.enrol.intro')}</p>
      <EnrolForm
        text={{
          passwordStep: t('auth.enrol.passwordStep'),
          password: t('auth.enrol.password'),
          begin: t('auth.enrol.begin'),
          scanTitle: t('auth.enrol.scanTitle'),
          scan: t('auth.enrol.scan'),
          qrLabel: t('auth.enrol.qrLabel'),
          manual: t('auth.enrol.manual'),
          code: t('auth.enrol.code'),
          codeHint: t('auth.enrol.codeHint'),
          verify: t('auth.enrol.verify'),
          backupTitle: t('auth.enrol.backupTitle'),
          backupIntro: t('auth.enrol.backupIntro'),
          backupList: t('auth.enrol.backupList'),
          done: t('auth.enrol.done'),
          restart: t('auth.challenge.restart'),
          errors: authErrors(t),
        }}
      />
      {/* Someone who signed in to the wrong account, or on a shared computer, can leave (A4.4). */}
      <p className={styles.footnote}>
        <SignOutButton label={t('auth.home.signOut')} />
      </p>
    </main>
  );
};

export default EnrolPage;
