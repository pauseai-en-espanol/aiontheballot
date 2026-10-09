import { createTranslator } from 'next-intl';

import { type Locale, messages } from './catalog.js';

export { isLocale, type Locale, LOCALES, type Messages, messages } from './catalog.js';

/** A translator usable anywhere: Next server components, share-image templates, API emails. */
export const getTranslator = (locale: Locale) =>
  createTranslator({ locale, messages: messages[locale] });
