import type { getTranslator } from '@aiontheballot/i18n/messages';
import type { ComponentProps } from 'react';

import type { SlugField } from '@/ui/SlugField';

import { problemText, template, territoryPickerText, writeErrors } from '@/ui/text';

import type { ElectionFormText } from './ElectionForm';

import { electionTypes } from './text';

type Translator = ReturnType<typeof getTranslator>;

/**
 * A slug field's words (admin forms §1.5): one label everywhere; for a new record that it follows the name, for a saved
 * one only what it may hold; either way, that it is fixed once the election is live.
 */
export const slugFieldText = (
  t: Translator,
  saved: boolean,
): ComponentProps<typeof SlugField>['text'] => ({
  label: t('admin.form.slug.label'),
  hint: `${saved ? t('admin.form.slug.hintSaved') : t('admin.form.slug.hint')} ${t('admin.form.slug.fixed')}`,
  address: template(t, 'admin.form.slug.preview'),
});

/** The election form's words, but its field-specific refusals. */
export const electionFormText = (
  t: Translator,
  save: string,
  saved: boolean,
): Omit<ElectionFormText, 'constraints'> => ({
  name: t('admin.elections.form.name'),
  nameHint: t('admin.elections.form.nameHint'),
  needed: t('admin.localized.needed'),
  optional: t('admin.form.optional'),
  slug: slugFieldText(t, saved),
  type: t('admin.elections.form.type'),
  types: electionTypes(t),
  territory: t('admin.elections.form.territory'),
  territoryHint: template(t, 'admin.elections.form.territoryHint'),
  territoryPickHint: t('admin.elections.form.territoryPickHint'),
  territoryPicker: territoryPickerText(t),
  territoryNone: t('admin.elections.form.territoryNone'),
  date: t('admin.elections.form.date'),
  dateHint: t('admin.elections.form.dateHint'),
  save,
  saved: t('admin.elections.form.saved'),
  created: t('admin.elections.form.created'),
  errors: writeErrors(t),
  problems: problemText(t),
});

/** An election's field-specific refusals, by the constraint that refused it (PLAN R78). */
export const electionConstraints = (t: Translator): Record<string, string> => ({
  slug_check: t('admin.elections.constraints.slug'),
  slug_length: t('admin.elections.constraints.slug'),
  elections_slug_check: t('admin.elections.constraints.slugLocale'),
  elections_slug_not_reserved: t('admin.elections.constraints.slugReserved'),
  elections_tenant_id_slug_key: t('admin.elections.constraints.slugTaken'),
  elections_check1: t('admin.elections.constraints.territoryNeeded'),
  elections_check: t('admin.elections.constraints.territoryNotAllowed'),
  elections_territory_code_check: t('admin.elections.constraints.territoryFormat'),
  localized_check: t('admin.elections.constraints.nameNeeded'),
});
