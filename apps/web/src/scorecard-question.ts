import { pickLocalized } from '@aiontheballot/domain/localized';
import { getTranslator } from '@aiontheballot/i18n/messages';

import type { LoadedElectionPage } from './election-page';

import { methodologyOf } from './election-view';

/**
 * The question an election's ratings answer, in the words of its methodology's kind, as the legend's scale: asked by
 * its summary and by its detailed table (public-site spec §5, "Wording").
 */
export const scorecardQuestion = (page: LoadedElectionPage): string => {
  const t = getTranslator(page.locale);
  const { home } = page.page;
  const { kind, owner } = methodologyOf(page.election, home.tenant.methodologyKind);
  if (kind === 'descriptive') {
    return t('election.question.descriptive');
  }
  return owner
    ? t('election.question.demands', {
        owner: pickLocalized(owner.name, page.locale, home.tenant.defaultLocale) ?? '',
      })
    : t('election.question.demandsUnnamed');
};
