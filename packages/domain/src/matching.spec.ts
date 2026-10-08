import { describe, expect, it } from 'vitest';

import { normalizeForMatch, quoteMatches } from './matching.js';

describe('normalizeForMatch', () => {
  it('expands ligatures (NFKC)', () => {
    expect(normalizeForMatch('ﬁnanciación')).toBe('financiación');
  });

  it('removes soft hyphens', () => {
    expect(normalizeForMatch('regu­lación')).toBe('regulación');
  });

  it('joins words hyphenated across a line break', () => {
    expect(normalizeForMatch('inteli-\n  gencia artificial')).toBe('inteligencia artificial');
  });

  it('keeps hyphens that are not at a line break', () => {
    expect(normalizeForMatch('socio-económico')).toBe('socio-económico');
  });

  it('folds typographic quotes and dashes', () => {
    expect(normalizeForMatch('“ejemplo” — ‘otro’')).toBe('"ejemplo" - \'otro\'');
  });

  it('collapses whitespace, including non-breaking spaces', () => {
    expect(normalizeForMatch('  una frase \n\n de   ejemplo ')).toBe('una frase de ejemplo');
  });
});

describe('quoteMatches', () => {
  const source = 'El Partido Ejemplo A propone una “agencia de\nsupervisión” para la IA.';

  it('matches a quote despite line breaks and quote styles', () => {
    expect(quoteMatches('"agencia de supervisión"', source)).toBe(true);
  });

  it('rejects text that is not in the source', () => {
    expect(quoteMatches('prohibición total', source)).toBe(false);
  });

  it('rejects an empty quote', () => {
    expect(quoteMatches('   ', source)).toBe(false);
  });
});
