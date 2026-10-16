import { MAX_QUOTE_LENGTH } from '@aiontheballot/domain/quote-match';

/**
 * A quote picked from a source's extracted text (editorial workflow C2): the passage an editor selected, as it is in
 * the text, and the page or section it is on. The database still matches the quote on save; this only fills the form.
 */

/** The most characters the page field takes (the API's limit on `sectionLabel`). */
export const MAX_SECTION_LABEL = 200;

/** One extracted unit, as the source's page lists them: a PDF's page or a web page's section. */
export interface PickUnit {
  label: string;
  body: string;
}

/** What a selection covers of one unit: its place in the list, and where in its body (UTF-16 offsets, as the DOM's). */
export interface PickedPart {
  unit: number;
  from: number;
  to: number;
}

export type Picked =
  | { kind: 'picked'; quote: string; label: string }
  /** Nothing but blanks, or nothing of the text at all. */
  | { kind: 'empty' }
  /** Longer than a quote may be, as the database counts it (characters, not UTF-16 units). */
  | { kind: 'too-long'; length: number };

const BLANK = /^\p{White_Space}*$/u;
const EDGES = /^\p{White_Space}+|\p{White_Space}+$/gu;

/**
 * The quote and its page from the parts of each unit a selection covers. The text is kept as it is in the source,
 * line breaks included, so it matches as the database matches it: units are joined with one space, as the database
 * joins pages, and blanks at either end are dropped. The page is the first unit's label, or the first's and the
 * last's, as the match names a span (`p. 47–p. 48`), counting only units the quote has text from.
 */
export const pickQuote = (units: readonly PickUnit[], parts: readonly PickedPart[]): Picked => {
  const texts = [...parts]
    .filter((part) => units[part.unit] !== undefined && part.to > part.from)
    .sort((a, b) => a.unit - b.unit || a.from - b.from)
    .map((part) => ({
      unit: units[part.unit] as PickUnit,
      text: (units[part.unit] as PickUnit).body.slice(part.from, part.to),
    }));
  while (texts.length > 0 && BLANK.test(texts[0]?.text ?? '')) {
    texts.shift();
  }
  while (texts.length > 0 && BLANK.test(texts.at(-1)?.text ?? '')) {
    texts.pop();
  }
  const [first, last] = [texts[0], texts.at(-1)];
  if (!first || !last) {
    return { kind: 'empty' };
  }
  const quote = texts
    .map(({ text }) => text)
    .join(' ')
    .replace(EDGES, '');
  const length = Array.from(quote).length;
  if (length > MAX_QUOTE_LENGTH) {
    return { kind: 'too-long', length };
  }
  const label =
    first.unit === last.unit ? first.unit.label : `${first.unit.label}–${last.unit.label}`;
  return { kind: 'picked', quote, label: Array.from(label).slice(0, MAX_SECTION_LABEL).join('') };
};
