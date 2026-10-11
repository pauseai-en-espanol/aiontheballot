import type { Metadata } from 'next';

import { getTranslator } from '@aiontheballot/i18n/messages';

import { InvitationLoader } from '@/auth/InvitationLoader';
import * as styles from '@/auth/styles';
import { getLocale } from '@/locale';
import { template } from '@/ui/text';

export const generateMetadata = async (): Promise<Metadata> => ({
  title: getTranslator(await getLocale())('auth.invitation.title'),
});

// Whoever holds the link, signed in or not: its token, which only the browser sees, alone decides, in the API.
const InvitationPage = async () => {
  const t = getTranslator(await getLocale());
  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t('auth.invitation.title')}</h1>
      <InvitationLoader
        text={{
          checking: t('auth.invitation.checking'),
          missing: t('auth.invitation.missing'),
          invalid: t('auth.invitation.invalid'),
          offer: template(t, 'auth.invitation.offer'),
          roles: {
            country_admin: t('email.roles.country_admin'),
            editor: t('email.roles.editor'),
            reviewer: t('email.roles.reviewer'),
          },
          newAccount: t('auth.invitation.newAccount'),
          name: t('auth.invitation.name'),
          nameHint: t('auth.invitation.nameHint'),
          password: t('auth.invitation.password'),
          passwordHint: t('auth.invitation.passwordHint'),
          confirm: t('auth.invitation.confirm'),
          mismatch: t('auth.invitation.mismatch'),
          create: t('auth.invitation.create'),
          created: t('auth.invitation.created'),
          signIn: t('auth.invitation.signIn'),
          existing: t('auth.invitation.existing'),
          accept: t('auth.invitation.accept'),
          accepted: t('auth.invitation.accepted'),
          toAdmin: t('auth.invitation.toAdmin'),
          otherAccount: t('auth.invitation.otherAccount'),
          failed: t('auth.invitation.failed'),
          limit: t('auth.invitation.limit'),
          nameMissing: t('auth.invitation.nameMissing'),
        }}
      />
    </main>
  );
};

export default InvitationPage;
