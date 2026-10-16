import { describe, expect, it } from 'vitest';

import { matchQuote, MAX_QUOTE_LENGTH, MIN_QUOTE_LENGTH, type SourceUnit } from './quote-match.js';

/** A fictional programme, a page per unit. */
const pages = (...bodies: string[]): SourceUnit[] =>
  bodies.map((body, i) => ({ index: i + 1, label: `p. ${i + 1}`, body }));

const PROGRAMME = pages(
  'El Partido Ejemplo A propone una moratoria ficticia sobre los sistemas de prueba.',
  'También pide crear una agencia de supervisión de ejemplo, con un presupuesto inventado.',
  'Y termina con una conclusión de ejemplo.',
);

describe('the live match of a quote', () => {
  it('finds a quote on one page, and names it as the public would see it', () => {
    expect(matchQuote('una moratoria ficticia', PROGRAMME)).toEqual({
      kind: 'matched',
      span: { fromUnit: 1, toUnit: 1, location: 'p. 1' },
    });
  });

  it('finds a quote across a page break, and names both pages', () => {
    expect(matchQuote('sistemas de prueba. También pide', PROGRAMME)).toEqual({
      kind: 'matched',
      span: { fromUnit: 1, toUnit: 2, location: 'p. 1–p. 2' },
    });
  });

  it('matches what normalisation makes equal: ligatures, hyphenation at a line break, typographic quotes', () => {
    const source = pages('Una «propuesta» de super-\nvisión ﬁcticia y ejemplar.');
    expect(matchQuote('"propuesta" de supervisión ficticia', source).kind).toBe('matched');
  });

  it('places a quote that starts or ends exactly on a page boundary on that page', () => {
    expect(matchQuote('También pide crear una agencia', PROGRAMME)).toMatchObject({
      span: { fromUnit: 2, toUnit: 2 },
    });
    expect(matchQuote('los sistemas de prueba.', PROGRAMME)).toMatchObject({
      span: { fromUnit: 1, toUnit: 1 },
    });
  });

  it('takes units in their order, whatever order they arrive in', () => {
    const shuffled = [PROGRAMME[2], PROGRAMME[0], PROGRAMME[1]] as SourceUnit[];
    expect(matchQuote('presupuesto inventado. Y termina', shuffled)).toMatchObject({
      span: { fromUnit: 2, toUnit: 3 },
    });
  });

  it('counts the first occurrence', () => {
    const source = pages('una frase repetida de ejemplo', 'una frase repetida de ejemplo');
    expect(matchQuote('una frase repetida', source)).toMatchObject({ span: { fromUnit: 1 } });
  });

  it(`refuses a quote shorter than ${MIN_QUOTE_LENGTH} characters once normalised, counting characters`, () => {
    expect(matchQuote('una  moratoria\u00AD', PROGRAMME)).toEqual({
      kind: 'too-short',
      length: 13,
      counted: 'normalised',
    });
    // Characters, not UTF-16 units: 14 characters (16 units) is too short, 15 is enough.
    const votes = pages('Votos 🗳🗳🗳 de ejemplo.');
    expect(matchQuote('🗳🗳 de ejemplo.', votes)).toEqual({
      kind: 'too-short',
      length: 14,
      counted: 'stored',
    });
    expect(matchQuote('🗳🗳🗳 de ejemplo.', votes)).toMatchObject({ kind: 'matched' });
  });

  it('counts a quote as its column does too: spaces at either end aside, before normalising', () => {
    const source = pages('Sobre la financiación de ejemplo.');
    // 14 characters as stored, 15 once its ligature is two letters: the database refuses to save it.
    expect(matchQuote('la ﬁnanciación', source)).toEqual({
      kind: 'too-short',
      length: 14,
      counted: 'stored',
    });
    expect(matchQuote('   la financiación   ', source)).toMatchObject({ kind: 'matched' });
    expect(matchQuote('  la ﬁnanciació  ', source)).toEqual({
      kind: 'too-short',
      length: 13,
      counted: 'stored',
    });
    // Only spaces: a tab at either end counts, as stored, and normalising drops it.
    expect(matchQuote('\tla ﬁnanciación', source)).toMatchObject({ kind: 'matched' });
  });

  it(`refuses a quote longer than ${MAX_QUOTE_LENGTH} characters as stored`, () => {
    const long = `${'palabra '.repeat(124)}palabras`;
    expect(Array.from(long)).toHaveLength(MAX_QUOTE_LENGTH);
    expect(matchQuote(` ${long} `, pages(long))).toMatchObject({ kind: 'matched' });
    expect(matchQuote(`${long}x`, pages(long))).toEqual({ kind: 'too-long', length: 1001 });
    expect(matchQuote(`${long.slice(0, -1)}🗳🗳`, pages(long))).toEqual({
      kind: 'too-long',
      length: 1001,
    });
  });

  it('shows how much of an unmatched quote does match: its longest start, with where it is', () => {
    expect(matchQuote('una moratoria ficticia sobre los sistemas de verdad', PROGRAMME)).toEqual({
      kind: 'unmatched',
      longest: {
        part: 'start',
        text: 'una moratoria ficticia sobre los sistemas de ',
        fromUnit: 1,
        toUnit: 1,
        location: 'p. 1',
      },
    });
  });

  it('or its longest end, when that is longer', () => {
    expect(matchQuote('La gran agencia de supervisión de ejemplo', PROGRAMME)).toMatchObject({
      kind: 'unmatched',
      longest: { part: 'end', text: ' agencia de supervisión de ejemplo', location: 'p. 2' },
    });
  });

  it('shows nothing when even the longest part is too short to mean anything', () => {
    expect(matchQuote('Nada de esto aparece en el programa', PROGRAMME)).toEqual({
      kind: 'unmatched',
      longest: null,
    });
    expect(matchQuote('una moratoria ficticia', [])).toEqual({ kind: 'unmatched', longest: null });
  });
});
