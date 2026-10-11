import type { LocaleOption } from './LocalizedField';

/** A localized field's values from its form, by language (LocalizedField names them `{name}.{code}`). */
export const localizedFromForm = (
  form: HTMLFormElement,
  name: string,
  locales: readonly LocaleOption[],
): Record<string, string> => {
  const data = new FormData(form);
  return Object.fromEntries(
    locales.map((locale) => {
      const value = data.get(`${name}.${locale.code}`);
      return [locale.code, typeof value === 'string' ? value : ''];
    }),
  );
};

/** A text field of a submitted form, as typed. */
export const formText = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
};
