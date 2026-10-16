import type { LocaleOption } from '@/ui/LocalizedField';

import { formText, localizedFromForm } from '@/ui/forms';

import type { FieldKind } from './fields';

/** Each column's longest value, as the API takes it (the draft forms' limits); other text, 300. */
export const MAX_LENGTH: Readonly<Record<string, number>> = {
  name: 200,
  short_name: 60,
  title: 300,
  short_title: 40,
  description: 5_000,
  body: 100_000,
  affiliation: 300,
  slug: 200,
  website: 500,
};

/** A value as the form gives it, for the column its field is: the database checks and normalizes it again. */
export const valueOf = (
  form: HTMLFormElement,
  name: string,
  kind: FieldKind,
  locales: readonly LocaleOption[],
): unknown => {
  const text = formText(form, name).trim();
  switch (kind) {
    case 'localized':
    case 'localizedLong':
      return Object.fromEntries(
        Object.entries(localizedFromForm(form, name, locales)).filter(([, v]) => v.trim() !== ''),
      );
    case 'colour':
      return text === '' ? null : text.toLowerCase();
    case 'codes': {
      const codes = text
        .split(/[\s,]+/u)
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean);
      return codes.length > 0 ? codes : null;
    }
    case 'number':
      return text === '' ? null : Number(text);
    case 'sourceKinds':
      return new FormData(form).getAll(name).filter((v): v is string => typeof v === 'string');
    case 'url':
    case 'date':
      return text === '' ? null : text;
    default:
      return text;
  }
};
