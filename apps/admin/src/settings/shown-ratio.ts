/**
 * A contrast ratio as the colour form says it (PLAN R178): one decimal, in the page's language, rounded down, so a
 * colour just short of WCAG AA never reads "4.5:1" beside its refusal.
 */
export const shownRatio = (ratio: number, locale: string): string =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    Math.floor(ratio * 10) / 10,
  );
