import type { getTranslator } from '@aiontheballot/i18n/messages';

import { colourFieldText, imageFieldText } from '@/changes/text';
import { problemText, territoryPickerText, writeErrors } from '@/ui/text';

import type { CriterionFormText } from './CriterionForm';
import type { PartyFormText } from './PartyForm';

import { slugFieldText } from './forms';

type Translator = ReturnType<typeof getTranslator>;

/** The party form's words; `saved`: for a party that exists already. */
export const partyFormText = (t: Translator, saved: boolean): PartyFormText => ({
  name: t('admin.parties.name'),
  shortName: t('admin.parties.shortName'),
  shortNameHint: t('admin.parties.shortNameHint'),
  needed: t('admin.localized.needed'),
  optional: t('admin.form.optional'),
  slug: slugFieldText(t, saved),
  logo: t('admin.parties.logo'),
  logoHint: t('admin.parties.logoHint'),
  logoAlt: String(t.raw('admin.parties.logoAlt')),
  image: imageFieldText(t),
  colour: t('admin.parties.colour'),
  colourHint: t('admin.parties.colourHint'),
  colourField: colourFieldText(t),
  website: t('admin.parties.website'),
  websiteHint: t('admin.parties.websiteHint'),
  territories: t('admin.parties.territories'),
  territoriesHint: String(t.raw('admin.parties.territoriesHint')),
  territoriesPickHint: t('admin.parties.territoriesPickHint'),
  territoryPicker: territoryPickerText(t),
  add: t('admin.parties.add'),
  save: t('admin.settings.save'),
  saved: t('admin.settings.saved'),
  added: t('admin.parties.added'),
  logoFailed: String(t.raw('admin.parties.logoFailed')),
  problems: {
    nameMissing: t('admin.parties.problems.nameMissing'),
    shortNameMissing: t('admin.parties.problems.shortNameMissing'),
    slugMissing: t('admin.parties.problems.slugMissing'),
    slugInvalid: t('admin.parties.problems.slugInvalid'),
    slugTaken: t('admin.parties.problems.slugTaken'),
    colourInvalid: t('admin.parties.problems.colourInvalid'),
    websiteInvalid: t('admin.parties.problems.websiteInvalid'),
    territoriesInvalid: String(t.raw('admin.parties.problems.territoriesInvalid')),
    nameNeeded: t('admin.parties.problems.nameNeeded'),
  },
  errors: writeErrors(t),
});

/** The criterion form's words; `saved`: for a criterion that exists already. */
export const criterionFormText = (t: Translator, saved: boolean): CriterionFormText => ({
  title: t('admin.criteria.title'),
  shortTitle: t('admin.criteria.shortTitle'),
  shortTitleHint: t('admin.criteria.shortTitleHint'),
  description: t('admin.criteria.description'),
  needed: t('admin.localized.needed'),
  slug: slugFieldText(t, saved),
  core: t('admin.criteria.core'),
  coreHint: t('admin.criteria.coreHint'),
  noCore: t('admin.criteria.noCore'),
  save: t('admin.settings.save'),
  saved: t('admin.settings.saved'),
  added: t('admin.criteria.added'),
  optional: t('admin.form.optional'),
  errors: writeErrors(t),
  problems: problemText(t),
  constraints: {
    slug_check: t('admin.elections.constraints.slug'),
    slug_length: t('admin.elections.constraints.slug'),
    criteria_election_id_slug_key: t('admin.criteria.slugTaken'),
    localized_check: t('admin.criteria.textNeeded'),
  },
});
