import { betterAuth } from 'better-auth';
import * as z from 'zod';

import { type AuthOptions, authOptions } from './auth.js';

export interface AccountLink {
  userId: string;
  /** Whether the account was made now, or already existed without a password. */
  created: boolean;
  /** Sets the account's password, once, within the hour (SET_PASSWORD_LINK_SECONDS). */
  link: string;
}

/**
 * Where the admin sets a password from a link. The token is in the fragment, which browsers never send: not to the
 * admin's server or the gateway (and so not to their logs or error reports), nor in a Referer. The page reads it and
 * takes it out of the address bar.
 */
export const setPasswordLink = (adminOrigin: string, token: string): string =>
  `${adminOrigin}/set-password#token=${encodeURIComponent(token)}`;

/** Better Auth's own rule for an address (zod's), so an account it can never sign in is never made. */
const EMAIL = z.email();

/**
 * An account for someone the owner vouches for (editorial workflow A1): its email marked verified, no password, no
 * TOTP, no role, and a single-use link to set its password, after which signing in leads to TOTP enrolment. For an
 * account that exists but never had a password (its link expired or was spent), only a new link. Any other existing
 * account is refused. It runs as aiontheballot_auth, like Better Auth in the API; making the account a platform admin
 * is the owner's SQL, since no runtime role can write app.platform_admins.
 */
export const accountLink = async (
  options: AuthOptions,
  { email, name }: { email: string; name: string },
): Promise<AccountLink> => {
  const address = email.trim().toLowerCase();
  if (!EMAIL.safeParse(address).success) {
    throw new Error('That is not an email address Better Auth accepts');
  }
  let token: string | undefined;
  const base = authOptions(options);
  const auth = betterAuth({
    ...base,
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      // The link is handed to the owner rather than emailed.
      sendResetPassword: async (data) => {
        token = data.token;
      },
    },
  });
  const context = await auth.$context;
  const existing = await context.internalAdapter.findUserByEmail(address, {
    includeAccounts: true,
  });
  if (existing) {
    const hasPassword = existing.accounts.some((account) => account.providerId === 'credential');
    const enrolled = (existing.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled;
    if (hasPassword || enrolled === true) {
      throw new Error('An account with this email address already exists and has a password');
    }
  } else if (name.trim() === '') {
    throw new Error('A new account needs a name');
  }
  const user =
    existing?.user ??
    (await context.internalAdapter.createUser(
      { email: address, name: name.trim(), emailVerified: true },
      // The password comes later, through the link, as with email and password.
      { method: 'email-password' },
    ));
  if (existing) {
    // A new link replaces any earlier one, which may have gone astray.
    await options.pool.query('DELETE FROM verifications WHERE value = $1', [user.id]);
  }
  try {
    await auth.api.requestPasswordReset({ body: { email: address } });
    if (token === undefined) {
      throw new Error('Better Auth made no link to set the password');
    }
  } catch (error) {
    // Never leave behind an account nobody can set a password for; if even that fails, a new run gives it a link.
    if (!existing) {
      try {
        await context.internalAdapter.deleteUser(user.id);
      } catch {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw new Error(
          `No link was made (${reason}), and the account ${user.id} was left: run the command again for a new link`,
        );
      }
    }
    throw error;
  }
  return { userId: user.id, created: !existing, link: setPasswordLink(options.adminOrigin, token) };
};
