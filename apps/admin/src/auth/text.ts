import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { AuthError } from './client';

type Translator = ReturnType<typeof getTranslator>;

/** The sign-in errors in the page's language, handed to the forms as plain strings. */
export const authErrors = (t: Translator): Record<AuthError, string> => ({
  invalidCredentials: t('auth.errors.invalidCredentials'),
  invalidPassword: t('auth.errors.invalidPassword'),
  invalidCode: t('auth.errors.invalidCode'),
  rateLimited: t('auth.errors.rateLimited'),
  locked: t('auth.errors.locked'),
  tooManyCodes: t('auth.errors.tooManyCodes'),
  expired: t('auth.errors.expired'),
  unexpected: t('auth.errors.unexpected'),
});
