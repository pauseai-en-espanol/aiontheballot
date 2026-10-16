import type { Locale } from '@aiontheballot/i18n/catalog';

import { betterAuth } from 'better-auth';

import type { PasswordMail } from './password-mail.js';

import { mailFailure } from '../mail/mailer.js';
import {
  type AuthOptions,
  authOptions,
  forgetPasswordLink,
  hasSecondFactor,
  heldBackPasswordLink,
  recentPasswordLinks,
} from './auth.js';

export type PasswordLinkResult = 'sent' | 'too-soon' | 'no-account' | 'not-enrolled';

/** The link was made but its email could not be sent (the link is forgotten): what may be logged of it (mailFailure). */
export class PasswordMailFailed extends Error {}

/**
 * "Send a password reset email" from a site's members (editorial workflow A7; PLAN R170): whoever manages the members
 * sends one of them a link to choose a new password. They never see the link or the password; the member gets the
 * link by email and chooses one as with "I forgot my password", with the same rules: single use, an hour, the second
 * factor kept, every session ended, a notice once it is changed.
 */
export interface PasswordLinks {
  /**
   * Makes the account a link and mails it, from `by` (the manager and the site, in the site's language). 'too-soon'
   * while another link sent in the last 15 minutes is unused; 'no-account' if the account is gone; 'not-enrolled' for
   * an account with no second factor yet, which a link would hand to whoever reads its mailbox (auth.ts). Rejects
   * with PasswordMailFailed if the email could not be sent.
   */
  send: (
    userId: string,
    by: { name: string; site: string; locale: Locale },
  ) => Promise<PasswordLinkResult>;
}

export const createPasswordLinks = (
  options: AuthOptions & { passwordMail: PasswordMail },
): PasswordLinks => {
  // Better Auth makes the link (its token kept only as a hash), and hands its token here rather than mailing it: in
  // order, per account, so each send takes the one it made.
  const tokens = new Map<string, string[]>();
  const base = authOptions(options);
  const auth = betterAuth({
    ...base,
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      sendResetPassword: async ({ user, token }) => {
        tokens.set(user.id, [...(tokens.get(user.id) ?? []), token]);
      },
    },
  });
  return {
    send: async (userId, by) => {
      const context = await auth.$context;
      const user = await context.internalAdapter.findUserById(userId);
      if (!user) {
        return 'no-account';
      }
      if (!hasSecondFactor(user)) {
        return 'not-enrolled';
      }
      if ((await recentPasswordLinks(options.pool, user.id)) > 0) {
        return 'too-soon';
      }
      await auth.api.requestPasswordReset({ body: { email: user.email } });
      const [token, ...rest] = tokens.get(user.id) ?? [];
      if (rest.length > 0) {
        tokens.set(user.id, rest);
      } else {
        tokens.delete(user.id);
      }
      if (token === undefined) {
        throw new Error('Better Auth made no link to choose a password');
      }
      // Another send for the account made its link at the same moment: exactly one of the two goes out (auth.ts).
      if (await heldBackPasswordLink(options.pool, user.id, token)) {
        return 'too-soon';
      }
      // Awaited, so whoever sent it learns whether it went out; a link that didn't is forgotten.
      try {
        await options.passwordMail.link({ email: user.email, token, locale: by.locale, by });
      } catch (error) {
        await forgetPasswordLink(options.pool, token);
        throw new PasswordMailFailed(mailFailure(error).message);
      }
      return 'sent';
    },
  };
};
