import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';

import { ForgotForm } from '@/auth/ForgotForm';
import * as styles from '@/auth/styles';
import { authErrors } from '@/auth/text';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';
import { template } from '@/ui/text';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.forgot.title'),
});

// For whoever can't sign in, as the sign-in page is: also while a code is awaited or an account is enrolling.
const ForgotPasswordPage = async () => {
  const { stage } = await requireStage('signed-out', 'challenge', 'enrol', 'unavailable');
  const t = getTranslator(await getLocale());
  if (stage === 'unavailable') {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>{t('auth.forgot.title')}</h1>
        <p className={styles.text}>{t('auth.signIn.unavailable')}</p>
      </main>
    );
  }
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.forgot.title')}</h1>
      <p className={styles.text}>{t('auth.forgot.intro')}</p>
      <ForgotForm
        text={{
          email: t('auth.forgot.email'),
          submit: t('auth.forgot.submit'),
          sentTitle: t('auth.forgot.sentTitle'),
          sent: template(t, 'auth.forgot.sent'),
          secondFactor: t('auth.forgot.secondFactor'),
          back: t('auth.forgot.back'),
          restart: t('auth.challenge.restart'),
          errors: authErrors(t),
        }}
      />
      <p className={`${styles.hint} ${styles.footnote}`}>{t('auth.forgot.lostAuthenticator')}</p>
    </main>
  );
};

export default ForgotPasswordPage;
