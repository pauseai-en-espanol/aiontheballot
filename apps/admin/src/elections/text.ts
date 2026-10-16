import type { getTranslator } from '@aiontheballot/i18n/messages';

import type { ElectionType } from './data';

type Translator = ReturnType<typeof getTranslator>;

/** An election's day, in the admin's language, written as a day (the date is kept as a day, not an instant). */
export const electionDate = (t: Translator, date: string | null): string =>
  date === null
    ? t('admin.elections.noDate')
    : t('admin.elections.day', { date: new Date(`${date}T12:00:00Z`) });

export const electionTypes = (t: Translator): Record<ElectionType, string> => ({
  general: t('admin.elections.types.general'),
  european: t('admin.elections.types.european'),
  regional: t('admin.elections.types.regional'),
  municipal: t('admin.elections.types.municipal'),
  other: t('admin.elections.types.other'),
});

/**
 * Whether the freeze window is set and not over: archiving then would leave it set for good (an archived election
 * can't be changed), and the corrections archiving promises frozen with it.
 */
export const freezeOpen = (
  window: { frozenFrom: string | null; frozenUntil: string | null },
  now = new Date(),
): boolean =>
  window.frozenFrom !== null && (window.frozenUntil === null || new Date(window.frozenUntil) > now);

/**
 * The freeze window in words (editorial workflow E6.3): frozen now, until when or until cleared, or starting later;
 * nothing once it is over or when there is none. Times in UTC, said so, since the server doesn't know the reader's.
 */
export const freezeLine = (
  t: Translator,
  window: { frozenFrom: string | null; frozenUntil: string | null },
  now = new Date(),
): string | undefined => {
  if (window.frozenFrom === null) {
    return undefined;
  }
  const from = new Date(window.frozenFrom);
  const until = window.frozenUntil === null ? null : new Date(window.frozenUntil);
  if (until !== null && until <= now) {
    return undefined;
  }
  if (from > now) {
    return t('admin.status.frozenSoon', { from });
  }
  return until === null
    ? t('admin.status.frozenOpenEnded', { from })
    : t('admin.status.frozenNow', { from, until });
};
