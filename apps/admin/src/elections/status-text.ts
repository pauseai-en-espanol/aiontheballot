import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { GoLiveChecklist } from './data';
import type { ChecklistItem } from './GoLivePanel';

type Translator = ReturnType<typeof getTranslator>;

/** The go-live checklist's items in words, in the order the database checks them (E5.2). */
export const goLiveNeeds = (
  t: Translator,
  list: GoLiveChecklist,
  language: string,
): ChecklistItem[] => {
  const missingIn = (slugs: string[]) =>
    slugs.length > 0 ? ` ${t('admin.status.missingIn', { slugs: slugs.join(', ') })}` : '';
  return [
    { label: t('admin.status.needs.activeTenant'), done: list.needs.activeTenant },
    { label: t('admin.status.needs.operator'), done: list.needs.operator },
    { label: t('admin.status.needs.methodology'), done: list.needs.methodology },
    { label: t('admin.status.needs.electionName', { language }), done: list.needs.electionName },
    {
      label: t('admin.status.needs.methodologyText', { language }),
      done: list.needs.methodologyText,
    },
    {
      label: `${t('admin.status.needs.partyNames', { language })}${missingIn(list.needs.partiesMissingNames)}`,
      done: list.needs.partiesMissingNames.length === 0,
    },
    {
      label: `${t('admin.status.needs.criteriaTexts', { language })}${missingIn(list.needs.criteriaMissingTexts)}`,
      done: list.needs.criteriaMissingTexts.length === 0,
    },
  ];
};

/** What going live only warns about (E5.3, W9, O3). */
export const goLiveWarnings = (t: Translator, list: GoLiveChecklist): string[] => [
  ...(list.warnings.noParties ? [t('admin.status.warnings.noParties')] : []),
  ...(list.warnings.noCriteria ? [t('admin.status.warnings.noCriteria')] : []),
  ...(list.warnings.noReviewers ? [t('admin.status.warnings.noReviewers')] : []),
  ...(list.warnings.unpublishedTexts.length > 0
    ? [
        t('admin.status.warnings.unpublishedTexts', {
          texts: list.warnings.unpublishedTexts
            .map((kind) => t(`admin.settings.texts.kinds.${kind}`))
            .join(', '),
        }),
      ]
    : []),
];
