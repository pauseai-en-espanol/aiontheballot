import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { TenantRole } from '@/data';

import { WRITE_ERRORS, type WriteError } from '@/write';

type Translator = ReturnType<typeof getTranslator>;

/** Every write error in the page's language, handed to client forms as plain strings. */
export const writeErrors = (t: Translator): Record<WriteError, string> =>
  Object.fromEntries(WRITE_ERRORS.map((key) => [key, t(`errors.${key}`)])) as Record<
    WriteError,
    string
  >;

export const roleNames = (t: Translator): Record<TenantRole, string> => ({
  country_admin: t('admin.roles.country_admin'),
  editor: t('admin.roles.editor'),
  reviewer: t('admin.roles.reviewer'),
});

/**
 * A message's raw text, its `{placeholders}` kept, for client components to fill in (fill.ts). next-intl's `raw`
 * returns the message as written.
 */
export const template = (t: Translator, key: Parameters<Translator['raw']>[0]): string =>
  String(t.raw(key));
