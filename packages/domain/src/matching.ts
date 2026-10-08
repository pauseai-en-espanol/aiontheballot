/**
 * Normalisation for the verbatim quote check (ADR-0002, data rules). Used for matching only: quotes are always shown
 * exactly as stored. Must stay identical to private.normalize_for_match() in the database; packages/db tests both on
 * the same fixtures.
 */
export const normalizeForMatch = (input: string): string =>
  input
    .normalize('NFKC')
    .replaceAll('\u00AD', '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/gu, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu, '-')
    // A whitespace run containing a line break; [^\S\n] keeps the regex free of backtracking.
    .replace(/(\p{L})-[^\S\n]*\n\s*(\p{L})/gu, '$1$2')
    .replace(/\s+/gu, ' ')
    .trim();

/** Whether `quote` appears in `source` once both are normalised. */
export const quoteMatches = (quote: string, source: string): boolean => {
  const needle = normalizeForMatch(quote);
  return needle.length > 0 && normalizeForMatch(source).includes(needle);
};
