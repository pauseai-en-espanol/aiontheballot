import type { Localized } from '@aiontheballot/domain/localized';

/**
 * Localized content in the page's language, else the site's default one; `lang` says which, so a text in another
 * language than the page's is marked as such (WCAG 3.1.2).
 */
export const localText = (
  value: Localized | null | undefined,
  locale: string,
  defaultLocale: string,
): { text: string; lang: string } => {
  if (value?.[locale]) {
    return { text: value[locale], lang: locale };
  }
  if (value?.[defaultLocale]) {
    return { text: value[defaultLocale], lang: defaultLocale };
  }
  const [lang, text] = Object.entries(value ?? {})[0] ?? [locale, ''];
  return { text, lang };
};
