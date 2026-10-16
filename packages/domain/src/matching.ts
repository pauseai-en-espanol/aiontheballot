/**
 * Normalisation for the verbatim quote check (ADR-0002, data rules). Used for matching only: quotes are always shown
 * exactly as stored. Must stay identical to private.normalize_for_match() in the database, which runs its regexes under
 * `pg_c_utf8`: letters are Unicode's Alphabetic and spaces its White_Space on both sides (PLAN R113). packages/db tests
 * both on the same fixtures.
 */
export const normalizeForMatch = (input: string): string =>
  input
    .normalize('NFKC')
    .replaceAll('\u00AD', '')
    // A byte-order mark, which copying from a PDF or a word processor brings in.
    .replaceAll('\uFEFF', '')
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/gu, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/gu, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/gu, '-')
    // A whitespace run containing a line break; [^\P{White_Space}\n] keeps the regex free of backtracking.
    .replace(/(\p{Alphabetic})-[^\P{White_Space}\n]*\n\p{White_Space}*(\p{Alphabetic})/gu, '$1$2')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();

/** Whether `quote` appears in `source` once both are normalised. */
export const quoteMatches = (quote: string, source: string): boolean => {
  const needle = normalizeForMatch(quote);
  return needle.length > 0 && normalizeForMatch(source).includes(needle);
};
