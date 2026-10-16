import { expect, type Page } from '@playwright/test';

import { createAccount, PASSWORD, visitorAddress } from './accounts.js';
import { ADMIN_URL } from './servers.js';
import { totpCode } from './totp.js';

/**
 * Signs `page` in as an account with TOTP through Better Auth's endpoints, as the admin's pages call them (the sign-in
 * tests go through the pages themselves): the password, enrolment and a code. The session's cookie lands in the
 * page's browser context. Each call is its own visitor at the gateway, so tests don't share the rate limit. Returns
 * the authenticator's secret, for a test that signs in again.
 */
export const signInEnrolled = async (page: Page, email: string): Promise<string> => {
  const headers = { origin: ADMIN_URL, 'x-e2e-client-address': visitorAddress() };
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`${ADMIN_URL}/api/auth${path}`, { data, headers });
    expect(response.status(), path).toBe(200);
    return response;
  };
  await post('/sign-in/email', { email, password: PASSWORD });
  const { totpURI } = (await (await post('/two-factor/enable', { password: PASSWORD })).json()) as {
    totpURI: string;
  };
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  await post('/two-factor/verify-totp', { code: totpCode(secret) });
  return secret;
};

/** A new account, signed in with TOTP; `created` collects its id for the test file to delete. */
export const signedInAccount = async (page: Page, created: string[], name?: string) => {
  const account = await createAccount(name);
  created.push(account.id);
  const secret = await signInEnrolled(page, account.email);
  return { ...account, secret };
};
