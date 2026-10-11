import { betterAuth } from 'better-auth';
import * as z from 'zod';

import { type AuthOptions, authOptions, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './auth.js';

/**
 * What invitations need of Better Auth's tables (editorial workflow A2, A3; PLAN R114), as aiontheballot_auth, the only
 * role that reads them: whether an account has an email, and a new account for an invited person, with the invited
 * email marked verified (following the link proves it) and the password they chose.
 */
export interface InvitedAccounts {
  /** The account with this email, if any. */
  accountId: (email: string) => Promise<string | undefined>;
  /** A new account; refused if the email is taken or the password too short. Its id. */
  create: (account: { email: string; name: string; password: string }) => Promise<string>;
  /** Removes an account just made, when its invitation could not be accepted after all. */
  remove: (userId: string) => Promise<void>;
}

/** Better Auth's own rule for an address (zod's), so an account it can never sign in is never made. */
const EMAIL = z.email();

export class InvitedAccountRefusal extends Error {
  constructor(readonly reason: 'exists' | 'password' | 'name' | 'email') {
    super(reason);
  }
}

export const createInvitedAccounts = (options: AuthOptions): InvitedAccounts => {
  const auth = betterAuth(authOptions(options));
  return {
    accountId: async (email) => {
      const context = await auth.$context;
      return (await context.internalAdapter.findUserByEmail(email.trim().toLowerCase()))?.user.id;
    },
    create: async ({ email, name, password }) => {
      const address = email.trim().toLowerCase();
      if (!EMAIL.safeParse(address).success) {
        throw new InvitedAccountRefusal('email');
      }
      if (name.trim() === '') {
        throw new InvitedAccountRefusal('name');
      }
      // Counted as Better Auth counts it on sign-in and reset, so the same passwords pass.
      if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        throw new InvitedAccountRefusal('password');
      }
      const context = await auth.$context;
      if (await context.internalAdapter.findUserByEmail(address)) {
        throw new InvitedAccountRefusal('exists');
      }
      const user = await context.internalAdapter.createUser(
        { email: address, name: name.trim(), emailVerified: true },
        { method: 'email-password' },
      );
      try {
        await context.internalAdapter.linkAccount({
          providerId: 'credential',
          accountId: user.id,
          userId: user.id,
          password: await context.password.hash(password),
        });
      } catch (error) {
        // An account with no password is never left behind; if even that fails, the first error is the one to see.
        await context.internalAdapter.deleteUser(user.id).catch(() => undefined);
        throw error;
      }
      return user.id;
    },
    remove: async (userId) => {
      const context = await auth.$context;
      await context.internalAdapter.deleteUser(userId);
    },
  };
};
