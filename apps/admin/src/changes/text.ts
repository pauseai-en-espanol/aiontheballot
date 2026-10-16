import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { ImageFieldText } from '@/ui/ImageField';

import { sourceKinds } from '@/sources/text';
import { problemText, template, territoryPickerText, writeErrors } from '@/ui/text';

import type { ChangeFormText } from './ChangeForm';

type Translator = ReturnType<typeof getTranslator>;

const FIELD_LABELS = [
  'name',
  'election_date',
  'body',
  'admissible_source_kinds',
  'not_mentioned_source_kinds',
  'affiliation',
  'display_order',
  'short_name',
  'colour',
  'website',
  'territory_codes',
  'title',
  'short_title',
  'description',
  'slug',
  'logo_file_id',
] as const;

/** Each change-controlled column's label, as the forms and the list name it; a slug's is every form's (§1.5). */
export const fieldLabels = (t: Translator): Record<string, string> =>
  Object.fromEntries(
    FIELD_LABELS.map((field) => [
      field,
      field === 'slug' ? t('admin.form.slug.label') : t(`admin.changes.labels.${field}`),
    ]),
  );

/** An image field's words (admin forms §1.1), for party logos and, later, brand images. */
export const imageFieldText = (t: Translator): ImageFieldText => ({
  drop: t('admin.form.image.drop'),
  choose: t('admin.form.image.choose'),
  replace: t('admin.form.image.replace'),
  remove: t('admin.form.image.remove'),
  undo: t('admin.form.image.undo'),
  chosen: String(t.raw('admin.form.image.chosen')),
  removing: t('admin.form.image.removing'),
  none: t('admin.form.image.none'),
  problems: {
    type: t('admin.form.image.problems.type'),
    size: t('admin.form.image.problems.size'),
    dimensions: t('admin.form.image.problems.dimensions'),
    unreadable: t('admin.form.image.problems.unreadable'),
  },
});

export const colourFieldText = (t: Translator) => ({
  none: t('admin.form.colour.none'),
  choose: t('admin.form.colour.choose'),
  remove: t('admin.form.colour.remove'),
  picker: t('admin.form.colour.picker'),
  code: t('admin.form.colour.code'),
  cancel: t('admin.form.colour.cancel'),
});

export const changeFormText = (t: Translator): ChangeFormText => ({
  current: t('admin.changes.form.current'),
  next: t('admin.changes.form.next'),
  changed: t('admin.changes.form.changed'),
  nothingChanged: t('admin.changes.form.nothingChanged'),
  none: t('admin.changes.form.none'),
  optional: t('admin.form.optional'),
  note: t('admin.changes.form.note'),
  noteHint: t('admin.changes.form.noteHint'),
  needed: t('admin.localized.needed'),
  propose: t('admin.changes.form.propose'),
  proposeAndApply: t('admin.changes.form.proposeAndApply'),
  applyHint: t('admin.changes.form.applyHint'),
  proposed: t('admin.changes.form.proposed'),
  applied: t('admin.changes.form.applied'),
  codesHint: t('admin.changes.form.codesHint'),
  codesPickHint: t('admin.changes.form.codesPickHint'),
  territoryPicker: territoryPickerText(t),
  slug: { hint: t('admin.form.slug.hint'), address: template(t, 'admin.form.slug.preview') },
  colour: colourFieldText(t),
  logo: t('admin.parties.logo'),
  logoHint: t('admin.parties.logoHint'),
  labels: fieldLabels(t),
  sourceKinds: sourceKinds(t),
  report: t('admin.changes.form.report'),
  reportHint: t('admin.changes.form.reportHint'),
  noReport: t('admin.changes.form.noReport'),
  // A proposal is public once approved, so it needs the site's main language from the start (CR1.6).
  errors: { ...writeErrors(t), needsDefaultLanguage: t('admin.changes.form.needsDefaultLanguage') },
  problems: problemText(t),
  defaultLanguage: template(t, 'admin.changes.form.defaultLanguage'),
  kindsNeeded: t('admin.methodology.kindsNeeded'),
  // What an approval writes is the database's to check, by the constraint it names (R78).
  constraints: {
    slug_check: t('admin.elections.constraints.slug'),
    slug_length: t('admin.elections.constraints.slug'),
    parties_election_id_slug_key: t('admin.parties.slugTaken'),
    criteria_election_id_slug_key: t('admin.criteria.slugTaken'),
    parties_colour_check: t('admin.parties.colourInvalid'),
    parties_website_check: t('admin.parties.websiteInvalid'),
    parties_territory_codes_check: t('admin.parties.territoriesInvalid'),
    methodologies_check1: t('admin.methodology.kindsNeeded'),
  },
});
