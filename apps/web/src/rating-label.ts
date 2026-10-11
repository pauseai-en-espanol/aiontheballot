import type { Rating } from '@aiontheballot/domain/methodology';

import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';

/** A rating's words, or the words of the pending and withdrawn states (public-site spec §5). */
export const ratingLabel = (locale: Locale, rating: Rating | 'pending' | 'withdrawn'): string => {
  const t = getTranslator(locale);
  return rating === 'pending'
    ? t('cell.pending')
    : rating === 'withdrawn'
      ? t('cell.withdrawn')
      : t(`rating.${rating}`);
};
