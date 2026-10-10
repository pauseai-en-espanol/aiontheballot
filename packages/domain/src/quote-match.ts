import { normalizeForMatch } from './matching.js';

/**
 * The live feedback of the cell editor (editorial workflow C2.6, W13): whether a quote matches its source verbatim, on
 * which pages, and if not, how much of it does. The database decides on save (`private.evidence_rules()`); this
 * mirrors it step for step, and a database test checks the two agree on every case:
 *
 * - each unit (a page or a section) is normalised on its own, and the units are joined in order with one space;
 * - the quote, as stored, has 15 to 1,000 characters once the spaces at either end are set aside (its column's
 *   CHECK, which refuses the save); normalised, it must have at least 15 and appear in that text; the first
 *   occurrence counts;
 * - the match spans from the last unit starting at or before its first character to the last unit starting at or
 *   before its last one; the public sees those units' labels, `p. 47` or `p. 47–p. 48`.
 */

/** The fewest characters a quote may have, as stored and once normalised, so it can't match almost anything. */
export const MIN_QUOTE_LENGTH = 15;
/** The most characters a quote may have as stored. */
export const MAX_QUOTE_LENGTH = 1000;

/** One extracted unit of a source: a PDF's page or a web page's section. */
export interface SourceUnit {
  index: number;
  label: string;
  body: string;
}

/** Where a match lies: its first and last unit, and the label the public would see. */
export interface UnitSpan {
  fromUnit: number;
  toUnit: number;
  location: string;
}

export type QuoteMatch =
  | { kind: 'matched'; span: UnitSpan }
  /**
   * Under 15 characters: as stored (spaces at either end aside), which the database refuses to save, or once
   * normalised, which it saves but never matches.
   */
  | { kind: 'too-short'; length: number; counted: 'stored' | 'normalised' }
  /** Over 1,000 characters as stored, which the database refuses to save. */
  | { kind: 'too-long'; length: number }
  | {
      kind: 'unmatched';
      /**
       * The longest start or end of the quote that does appear, normalised, with where it is: the difference begins
       * right after it (or right before it). None when even that is shorter than a quote may be.
       */
      longest: (UnitSpan & { part: 'start' | 'end'; text: string }) | null;
    };

/** A text's characters (code points), as the database counts them: not UTF-16 units, nor what readers see as one. */
const codePoints = (text: string): string[] => Array.from(text);
const characters = (text: string): number => codePoints(text).length;

/** The text without the spaces at either end, as the database's `btrim` leaves it: only spaces, not other blanks. */
const trimSpaces = (text: string): string => {
  let [start, end] = [0, text.length];
  while (start < end && text[start] === ' ') {
    start += 1;
  }
  while (end > start && text[end - 1] === ' ') {
    end -= 1;
  }
  return text.slice(start, end);
};

/**
 * The longest prefix (or suffix) of `needle` found in `haystack`, by binary search on its length: a shorter part of a
 * part that is found is found too. Splits only between characters, never inside one.
 */
const longestFound = (needle: string[], haystack: string, part: 'start' | 'end'): string => {
  const slice = (length: number) =>
    (part === 'start' ? needle.slice(0, length) : needle.slice(needle.length - length)).join('');
  let found = 0;
  let missing = needle.length + 1;
  while (missing - found > 1) {
    const middle = Math.floor((found + missing) / 2);
    if (haystack.includes(slice(middle))) {
      found = middle;
    } else {
      missing = middle;
    }
  }
  return slice(found);
};

export const matchQuote = (quote: string, units: readonly SourceUnit[]): QuoteMatch => {
  // The column's CHECK first: normalising can lengthen a quote (a ligature becomes two letters), never make it savable.
  const stored = characters(trimSpaces(quote));
  if (stored > MAX_QUOTE_LENGTH) {
    return { kind: 'too-long', length: stored };
  }
  if (stored < MIN_QUOTE_LENGTH) {
    return { kind: 'too-short', length: stored, counted: 'stored' };
  }
  const needle = normalizeForMatch(quote);
  const length = characters(needle);
  if (length < MIN_QUOTE_LENGTH) {
    return { kind: 'too-short', length, counted: 'normalised' };
  }
  const ordered = [...units].sort((a, b) => a.index - b.index);
  const texts = ordered.map((unit) => normalizeForMatch(unit.body));
  const joined = texts.join(' ');
  const starts: number[] = [];
  let next = 0;
  for (const text of texts) {
    starts.push(next);
    next += text.length + 1;
  }
  const unitAt = (offset: number): SourceUnit => {
    let found = 0;
    starts.forEach((start, i) => {
      if (start <= offset) {
        found = i;
      }
    });
    return ordered[found] as SourceUnit;
  };
  const span = (at: number, text: string): UnitSpan => {
    const [from, to] = [unitAt(at), unitAt(at + text.length - 1)];
    return {
      fromUnit: from.index,
      toUnit: to.index,
      location: from === to ? from.label : `${from.label}–${to.label}`,
    };
  };

  const at = joined.indexOf(needle);
  if (at >= 0) {
    return { kind: 'matched', span: span(at, needle) };
  }
  const cut = codePoints(needle);
  const [start, end] = [longestFound(cut, joined, 'start'), longestFound(cut, joined, 'end')];
  const [part, text] =
    characters(end) > characters(start) ? (['end', end] as const) : (['start', start] as const);
  return {
    kind: 'unmatched',
    longest:
      characters(text) >= MIN_QUOTE_LENGTH
        ? { part, text, ...span(joined.indexOf(text), text) }
        : null,
  };
};
