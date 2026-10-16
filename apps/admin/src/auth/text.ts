import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { AuthError } from './client';

type Translator = ReturnType<typeof getTranslator>;

/** The sign-in errors in the page's language, handed to the forms as plain strings. */
export const authErrors = (t: Translator): Record<AuthError, string> => ({
  invalidCredentials: t('auth.errors.invalidCredentials'),
  invalidEmail: t('auth.errors.invalidEmail'),
  invalidPassword: t('auth.errors.invalidPassword'),
  invalidCode: t('auth.errors.invalidCode'),
  rateLimited: t('auth.errors.rateLimited'),
  locked: t('auth.errors.locked'),
  tooManyCodes: t('auth.errors.tooManyCodes'),
  expired: t('auth.errors.expired'),
  invalidLink: t('auth.errors.invalidLink'),
  passwordTooShort: t('auth.errors.passwordTooShort'),
  passwordTooLong: t('auth.errors.passwordTooLong'),
  passwordsDiffer: t('auth.errors.passwordsDiffer'),
  unexpected: t('auth.errors.unexpected'),
});
