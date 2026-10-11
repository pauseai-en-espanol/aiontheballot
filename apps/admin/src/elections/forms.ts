import type { getTranslator } from '@aiontheballot/i18n/messages';

import { template, writeErrors } from '@/ui/text';

import type { ElectionFormText } from './ElectionForm';

import { electionTypes } from './text';

type Translator = ReturnType<typeof getTranslator>;

/** The election form's words, but its field-specific refusals. */
export const electionFormText = (
  t: Translator,
  save: string,
): Omit<ElectionFormText, 'constraints'> => ({
  name: t('admin.elections.form.name'),
  nameHint: t('admin.elections.form.nameHint'),
  needed: t('admin.localized.needed'),
  slug: t('admin.elections.form.slug'),
  slugHint: t('admin.elections.form.slugHint'),
  type: t('admin.elections.form.type'),
  types: electionTypes(t),
  territory: t('admin.elections.form.territory'),
  territoryHint: template(t, 'admin.elections.form.territoryHint'),
  territoryNone: t('admin.elections.form.territoryNone'),
  date: t('admin.elections.form.date'),
  dateHint: t('admin.elections.form.dateHint'),
  save,
  saved: t('admin.elections.form.saved'),
  errors: writeErrors(t),
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
