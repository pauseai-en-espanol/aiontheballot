import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';

import type { Mailer } from '../mail/mailer.js';

import { plainName } from '../admin/invitations.js';
import { setPasswordLink } from './accounts.js';

/**
 * The account mail of password recovery (editorial workflow A5; PLAN R170), from the platform's sender and in the
 * platform's name: a link to choose a new password, asked for on the sign-in page or sent by whoever manages a site's
 * members, and the notice that a password was changed. The link carries its token in the fragment (setPasswordLink).
 */
export interface PasswordMail {
  /** A link to choose a new password; `by` names the manager who sent it from a site's members. */
  link: (message: {
    email: string;
    token: string;
    locale: Locale;
    by?: { name: string; site: string } | undefined;
  }) => Promise<void>;
  /**
   * That the account's password was just changed through such a link; `enrolled`: whether the account has its second
   * factor (without, the owner's link set it, D19, and whoever signs in next sets one up).
   */
  changed: (message: { email: string; locale: Locale; enrolled?: boolean }) => Promise<void>;
}

export const createPasswordMail = ({
  mailer,
  adminOrigin,
  platformName,
}: {
  mailer: Mailer;
  adminOrigin: string;
  platformName: string;
}): PasswordMail => ({
  link: async ({ email, token, locale, by }) => {
    const t = getTranslator(locale);
    const link = setPasswordLink(adminOrigin, token);
    const manager = by ? plainName(by.name) : '';
    await mailer.send({
      to: email,
      fromName: platformName,
      subject: t('email.passwordReset.subject', { platform: platformName }),
      text: by
        ? t('email.passwordReset.bodyByManager', {
            manager: manager === '' ? t('email.passwordReset.someManager') : manager,
            site: by.site,
            platform: platformName,
            link,
          })
        : t('email.passwordReset.body', { platform: platformName, link }),
    });
  },
  changed: async ({ email, locale, enrolled = true }) => {
    const t = getTranslator(locale);
    await mailer.send({
      to: email,
      fromName: platformName,
      subject: t('email.passwordChanged.subject', { platform: platformName }),
      text: enrolled
        ? t('email.passwordChanged.body', {
            platform: platformName,
            signIn: `${adminOrigin}/forgot-password`,
          })
        : t('email.passwordChanged.bodyNoFactor', { platform: platformName }),
    });
  },
});
