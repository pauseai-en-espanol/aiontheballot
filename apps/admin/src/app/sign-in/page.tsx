import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';

import { PasskeySignIn } from '@/auth/PasskeySignIn';
import { SignInForm } from '@/auth/SignInForm';
import * as styles from '@/auth/styles';
import { authErrors } from '@/auth/text';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.signIn.title'),
});

// Also while a code is awaited or an account is enrolling, so that someone can start again with another account.
const SignInPage = async () => {
  const { stage } = await requireStage('signed-out', 'challenge', 'enrol', 'unavailable');
  const t = getTranslator(await getLocale());
  if (stage === 'unavailable') {
    return (
      <main className={styles.page}>
        <h1 className={styles.heading}>{t('auth.signIn.title')}</h1>
        <p className={styles.text}>{t('auth.signIn.unavailable')}</p>
      </main>
    );
  }
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.signIn.title')}</h1>
      <p className={styles.text}>{t('auth.signIn.intro')}</p>
      <SignInForm
        text={{
          email: t('auth.signIn.email'),
          password: t('auth.signIn.password'),
          submit: t('auth.signIn.submit'),
          restart: t('auth.challenge.restart'),
          errors: authErrors(t),
        }}
      />
      <p className={styles.footnote}>
        <Link className={styles.link} href="/forgot-password">
          {t('auth.signIn.forgot')}
        </Link>
      </p>
      <PasskeySignIn
        text={{
          question: t('auth.signIn.passkeyQuestion'),
          button: t('auth.signIn.passkey'),
          hint: t('auth.signIn.passkeyHint'),
          restart: t('auth.challenge.restart'),
          errors: authErrors(t),
        }}
      />
      <p className={`${styles.hint} ${styles.footnote}`}>{t('auth.signIn.noAccount')}</p>
    </main>
  );
};

export default SignInPage;
