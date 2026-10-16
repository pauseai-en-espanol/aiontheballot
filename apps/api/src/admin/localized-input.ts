import type { Localized } from '@aiontheballot/domain/localized';

/**
 * Localized text as a form sends it, one entry per language the tenant enables (editorial workflow §2.4), made ready
 * for a localized column: blank entries are dropped, since the column refuses them, and text is kept as typed. An
 * entry for a language the tenant doesn't enable is refused (`invalid`): the admin never sends one. With nothing left
 * it is `empty`, which a required column refuses and an optional one stores as null.
 */
export const localizedInput = (
  value: Readonly<Record<string, unknown>>,
  enabledLocales: readonly string[],
): Localized | 'empty' | 'invalid' => {
  const entries = Object.entries(value);
  if (
    entries.some(([locale, text]) => !enabledLocales.includes(locale) || typeof text !== 'string')
  ) {
    return 'invalid';
  }
  const kept = entries.filter(([, text]) => (text as string).trim() !== '') as [string, string][];
  return kept.length === 0 ? 'empty' : Object.fromEntries(kept);
};

/** The JSON schema of such a value: an object of strings, at most `maxLength` characters each. */
export const localizedSchema = (maxLength: number) =>
  ({
    type: 'object',
    additionalProperties: { type: 'string', maxLength },
    maxProperties: 16,
  }) as const;
