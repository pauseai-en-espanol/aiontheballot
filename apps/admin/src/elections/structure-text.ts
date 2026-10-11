import type { getTranslator } from '@aiontheballot/i18n/messages';

import { writeErrors } from '@/ui/text';

import type { CriterionFormText } from './CriterionForm';
import type { PartyFormText } from './PartyForm';

type Translator = ReturnType<typeof getTranslator>;

export const partyFormText = (t: Translator): PartyFormText => ({
  name: t('admin.parties.name'),
  shortName: t('admin.parties.shortName'),
  shortNameHint: t('admin.parties.shortNameHint'),
  needed: t('admin.localized.needed'),
  slug: t('admin.elections.form.slug'),
  slugHint: t('admin.parties.slugHint'),
  colour: t('admin.parties.colour'),
  colourHint: t('admin.parties.colourHint'),
  noColour: t('admin.parties.noColour'),
  website: t('admin.parties.website'),
  territories: t('admin.parties.territories'),
  territoriesHint: String(t.raw('admin.parties.territoriesHint')),
  save: t('admin.settings.save'),
  saved: t('admin.settings.saved'),
  errors: writeErrors(t),
  constraints: {
    slug_check: t('admin.elections.constraints.slug'),
    slug_length: t('admin.elections.constraints.slug'),
    parties_election_id_slug_key: t('admin.parties.slugTaken'),
    parties_colour_check: t('admin.parties.colourInvalid'),
    parties_website_check: t('admin.parties.websiteInvalid'),
    parties_territory_codes_check: t('admin.parties.territoriesInvalid'),
    localized_check: t('admin.elections.constraints.nameNeeded'),
  },
});

export const criterionFormText = (t: Translator): CriterionFormText => ({
  title: t('admin.criteria.title'),
  shortTitle: t('admin.criteria.shortTitle'),
  shortTitleHint: t('admin.criteria.shortTitleHint'),
  description: t('admin.criteria.description'),
  needed: t('admin.localized.needed'),
  slug: t('admin.elections.form.slug'),
  slugHint: t('admin.criteria.slugHint'),
  core: t('admin.criteria.core'),
  coreHint: t('admin.criteria.coreHint'),
  noCore: t('admin.criteria.noCore'),
  save: t('admin.settings.save'),
  saved: t('admin.settings.saved'),
  errors: writeErrors(t),
  constraints: {
    slug_check: t('admin.elections.constraints.slug'),
    slug_length: t('admin.elections.constraints.slug'),
    criteria_election_id_slug_key: t('admin.criteria.slugTaken'),
    localized_check: t('admin.criteria.textNeeded'),
  },
});
