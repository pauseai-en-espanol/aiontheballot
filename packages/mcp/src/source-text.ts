import { asItReads } from '@aiontheballot/domain/quote-match';

/**
 * A source's extracted text as a tool reads it (PLAN R232). A programme runs to hundreds of pages, more than a
 * conversation holds, so a tool searches it for words, or reads a few of its units (a PDF's pages, a web page's
 * sections) at a time. Either way each unit is shown as it reads (`asItReads`), as the admin's quote picker takes a
 * passage, so a quote copied from what is shown matches as the database matches it.
 */

/** One extracted unit, as the admin's API gives it. */
export interface Unit {
  index: number;
  label: string;
  body: string;
}

/** Characters shown on either side of a word found, before the passage is widened to whole words. */
export const CONTEXT = 300;
/** The most passages one search shows; the count says how many more there are. */
export const MAX_PASSAGES = 30;
/** The most units, and characters, one read shows; `next` says where to go on. */
export const MAX_UNITS = 12;
export const MAX_CHARACTERS = 40_000;

export interface Passage {
  unit: number;
  label: string;
  /** Whether it starts at the start of its unit, and ends at its end: otherwise the unit's text goes on. */
  atStart: boolean;
  atEnd: boolean;
  text: string;
}

/** A character as a search compares it: lower case, without accents (`é` as `e`, `Ñ` as `n`). */
const fold = (character: string): string =>
  character.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase();

/** The text folded, with where in the text each of its UTF-16 units came from, and where that character ends. */
const folded = (text: string): { text: string; from: number[]; to: number[] } => {
  let out = '';
  const [from, to]: [number[], number[]] = [[], []];
  let at = 0;
  for (const character of text) {
    const end = at + character.length;
    const each = fold(character);
    out += each;
    for (let i = 0; i < each.length; i += 1) {
      from.push(at);
      to.push(end);
    }
    at = end;
  }
  return { text: out, from, to };
};

const BLANK = /\s/u;

/** The span widened to whole words: to the blank before its start and after its end, or the text's ends. */
const wholeWords = (text: string, start: number, end: number): [number, number] => {
  let [a, b] = [Math.max(0, start), Math.min(text.length, end)];
  while (a > 0 && !BLANK.test(text[a - 1] ?? ' ')) {
    a -= 1;
  }
  while (b < text.length && !BLANK.test(text[b] ?? ' ')) {
    b += 1;
  }
  return [a, b];
};

/**
 * The passages of the units where any of the terms is, in the units' order: the words around each, the passages of a
 * unit that overlap joined into one. Terms are compared in lower case and without accents, as written otherwise.
 */
export const searchUnits = (
  units: readonly Unit[],
  terms: readonly string[],
): { found: number; passages: Passage[] } => {
  const needles = [...new Set(terms.map((term) => folded(term.trim()).text))].filter(
    (needle) => needle.length > 0,
  );
  const passages: Passage[] = [];
  let found = 0;
  for (const unit of [...units].sort((a, b) => a.index - b.index)) {
    const text = asItReads(unit.body).trim();
    const haystack = folded(text);
    const spans: [number, number][] = [];
    for (const needle of needles) {
      for (
        let at = haystack.text.indexOf(needle);
        at >= 0;
        at = haystack.text.indexOf(needle, at + 1)
      ) {
        const [start, end] = [
          haystack.from[at] ?? 0,
          haystack.to[at + needle.length - 1] ?? text.length,
        ];
        spans.push(wholeWords(text, start - CONTEXT, end + CONTEXT));
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span[0] <= last[1]) {
        last[1] = Math.max(last[1], span[1]);
      } else {
        merged.push([...span]);
      }
    }
    found += merged.length;
    for (const [start, end] of merged) {
      if (passages.length < MAX_PASSAGES) {
        passages.push({
          unit: unit.index,
          label: unit.label,
          atStart: start === 0,
          atEnd: end === text.length,
          text: text.slice(start, end).trim(),
        });
      }
    }
  }
  return { found, passages };
};

/**
 * The units from `from` to `to` (their indexes, both included), whole and as they read, up to MAX_UNITS of them and
 * MAX_CHARACTERS in all (always one at least); `next` is the first not shown, when the range goes on.
 */
export const readUnits = (
  units: readonly Unit[],
  from: number,
  to: number,
): { units: { index: number; label: string; text: string }[]; next: number | null } => {
  const wanted = [...units]
    .sort((a, b) => a.index - b.index)
    .filter((unit) => unit.index >= from && unit.index <= to);
  const shown: { index: number; label: string; text: string }[] = [];
  let characters = 0;
  for (const unit of wanted) {
    const text = asItReads(unit.body).trim();
    if (
      shown.length > 0 &&
      (shown.length >= MAX_UNITS || characters + text.length > MAX_CHARACTERS)
    ) {
      return { units: shown, next: unit.index };
    }
    shown.push({ index: unit.index, label: unit.label, text });
    characters += text.length;
  }
  return { units: shown, next: null };
};
