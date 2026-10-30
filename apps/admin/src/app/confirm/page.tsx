import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { safeNext } from '@/auth/confirm';
import { PasskeySignIn } from '@/auth/PasskeySignIn';
import { StepUpForm } from '@/auth/StepUpForm';
import * as styles from '@/auth/styles';
import { authErrors } from '@/auth/text';
import { getLocale } from '@/locale';
import { requireStage } from '@/session';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.stepUp.title'),
});

/**
 * "Confirm it's you" (PLAN D23): the riskiest actions (who has access to a site, its settings, going live and the
 * review rules, erasure, the audit logs, minting a token, adding a passkey) want a second factor of the last 12 hours.
 * A code from the app, or a passkey, which signs in afresh; then back to the page that asked (`next`, a path of the
 * admin only).
 */
const ConfirmPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const session = await requireStage('signed-in');
  const { next: asked } = await searchParams;
  const next = safeNext(Array.isArray(asked) ? asked[0] : asked);
  if (session.recentSecondFactor === true) {
    redirect(next);
  }
  const t = getTranslator(await getLocale());
  const errors = authErrors(t);
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.stepUp.title')}</h1>
      <StepUpForm
        next={next}
        text={{
          intro: t('auth.stepUp.intro'),
          code: t('auth.challenge.code'),
          submit: t('auth.stepUp.submit'),
          restart: t('auth.challenge.restart'),
          errors,
        }}
      />
      <PasskeySignIn
        next={next}
        text={{
          question: t('auth.signIn.passkeyQuestion'),
          button: t('auth.signIn.passkey'),
          hint: t('auth.stepUp.passkeyHint'),
          restart: t('auth.challenge.restart'),
          errors,
        }}
      />
      <p className={`${styles.hint} ${styles.footnote}`}>{t('auth.stepUp.noApp')}</p>
      <p className={styles.footnote}>
        <Link className={styles.link} href="/">
          {t('auth.stepUp.back')}
        </Link>
      </p>
    </main>
  );
};

export default ConfirmPage;
