import { createTranslator } from 'next-intl';

import { type Locale, messages } from './catalog.js';

export { isLocale, type Locale, LOCALES, type Messages, messages } from './catalog.js';

/**
 * A translator usable anywhere: Next server components, share-image templates, API emails. Dates are formatted in UTC,
 * not the process's time zone: an election's date is kept as noon UTC, which another zone could move to the next or
 * previous day.
 */
export const getTranslator = (locale: Locale) =>
  createTranslator({ locale, messages: messages[locale], timeZone: 'UTC' });
