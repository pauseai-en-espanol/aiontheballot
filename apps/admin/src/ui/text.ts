import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { TenantRole } from '@/data';

import { WRITE_ERRORS, type WriteError } from '@/write';

import type { ProblemText } from './checks';
import type { FileFieldText } from './FileField';
import type { TerritoryPickerText } from './TerritoryPicker';

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

/** The shared words for what is wrong with a field (admin forms §1.2). */
export const problemText = (t: Translator): ProblemText => ({
  required: t('admin.form.problems.required'),
  localized: t('admin.form.problems.localized'),
  confirm: t('admin.form.problems.confirm'),
  choose: t('admin.form.problems.choose'),
  email: t('admin.form.problems.email'),
  url: t('admin.form.problems.url'),
  https: t('admin.form.problems.https'),
  slug: t('admin.form.problems.slug'),
  whole: template(t, 'admin.form.problems.whole'),
  invalid: t('admin.form.problems.invalid'),
});

/** A document field's words (admin forms §1.1), for a source's copy. */
export const fileFieldText = (t: Translator): FileFieldText => ({
  drop: t('admin.form.file.drop'),
  choose: t('admin.form.file.choose'),
  replace: t('admin.form.file.replace'),
  remove: t('admin.form.file.remove'),
  chosen: template(t, 'admin.form.file.chosen'),
  none: t('admin.form.file.none'),
  problems: {
    type: t('admin.form.file.problems.type'),
    size: t('admin.form.file.problems.size'),
    missing: t('admin.form.file.problems.missing'),
  },
});

/** A Markdown text's two views (PLAN R196). */
export const markdownText = (t: Translator) => ({
  write: t('admin.form.markdown.write'),
  preview: t('admin.form.markdown.preview'),
  empty: t('admin.form.markdown.empty'),
});

/** The territory picker's words (PLAN R201). */
export const territoryPickerText = (t: Translator): TerritoryPickerText => ({
  find: t('admin.form.territories.find'),
  findHint: t('admin.form.territories.findHint'),
  within: template(t, 'admin.form.territories.within'),
  chosen: template(t, 'admin.form.territories.chosen'),
  noneChosen: t('admin.form.territories.noneChosen'),
  noMatch: t('admin.form.territories.noMatch'),
  other: t('admin.form.territories.other'),
  whole: t('admin.form.territories.whole'),
  choose: t('admin.form.territories.choose'),
});
