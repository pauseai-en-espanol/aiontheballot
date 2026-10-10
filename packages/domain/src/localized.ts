/** Content in several languages, keyed by locale (`{"es": "…", "en": "…"}`), as localized jsonb columns store it. */
export type Localized = Readonly<Record<string, string>>;

export const isLocalized = (value: unknown): value is Localized =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((text) => typeof text === 'string');

/**
 * The text for `locale`, else for the tenant's default locale, else undefined. Never another language: a page in a
 * locale the content lacks falls back to the tenant's own language only. Empty strings count as missing.
 */
export const pickLocalized = (
  value: Localized,
  locale: string,
  defaultLocale: string,
): string | undefined => value[locale] || value[defaultLocale] || undefined;
