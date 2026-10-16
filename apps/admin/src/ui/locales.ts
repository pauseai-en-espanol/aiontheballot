import type { LocaleOption } from './LocalizedField';

/** A language's name in the admin's language as a sentence has it ("en español", "in Spanish"; admin forms §2). */
export const languageInSentence = (code: string, uiLocale: string): string =>
  new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code) ?? code;

/** A language's name in the admin's language, capitalised as a label starts ("Español", "Spanish"). */
export const languageName = (code: string, uiLocale: string): string => {
  const name = languageInSentence(code, uiLocale);
  return name.charAt(0).toLocaleUpperCase(uiLocale) + name.slice(1);
};

/** The tenant's languages for a localized field, its default first, which publishing needs (editorial workflow §2.4). */
export const localeOptions = (
  tenant: { defaultLocale: string; enabledLocales: readonly string[] },
  uiLocale: string,
  { defaultRequired = true }: { defaultRequired?: boolean } = {},
): LocaleOption[] =>
  [
    tenant.defaultLocale,
    ...tenant.enabledLocales.filter((code) => code !== tenant.defaultLocale),
  ].map((code) => ({
    code,
    label: languageName(code, uiLocale),
    name: languageInSentence(code, uiLocale),
    required: defaultRequired && code === tenant.defaultLocale,
  }));
