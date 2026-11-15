import { matchQuote } from '@aiontheballot/domain/quote-match';
import { describe, expect, it } from 'vitest';

import { CONTEXT, MAX_PASSAGES, MAX_UNITS, readUnits, searchUnits } from './source-text.js';

/** A fictional programme's pages, as the worker extracts them: line breaks, and a word split across two lines. */
const UNITS = [
  { index: 0, label: 'p. 1', body: 'Índice del programa de ejemplo.\nPrimera parte.' },
  {
    index: 1,
    label: 'p. 2',
    body:
      'El Partido Ejemplo A propone una agencia de evalua-\nción de sistemas de inteligencia artificial.\n\n' +
      'También propone más bibliotecas.',
  },
  {
    index: 2,
    label: 'p. 3',
    body: 'Sin nada sobre el asunto. ' + 'Relleno de ejemplo. '.repeat(60),
  },
];

describe('a source’s text, as a tool reads it (PLAN R232)', () => {
  it('finds words in lower case and without accents, and shows them as they read', () => {
    const { found, passages } = searchUnits(UNITS, ['EVALUACION', 'Inteligencia Artificial']);
    expect(found).toBe(1);
    expect(passages).toEqual([
      {
        unit: 1,
        label: 'p. 2',
        atStart: true,
        atEnd: true,
        text:
          'El Partido Ejemplo A propone una agencia de evaluación de sistemas de inteligencia artificial. ' +
          'También propone más bibliotecas.',
      },
    ]);
  });

  it('shows text a quote copied from matches, as the database matches it', () => {
    const [passage] = searchUnits(UNITS, ['agencia']).passages;
    const quote = passage?.text.slice(0, passage.text.indexOf('.') + 1) ?? '';
    expect(quote).toBe(
      'El Partido Ejemplo A propone una agencia de evaluación de sistemas de inteligencia artificial.',
    );
    expect(matchQuote(quote, UNITS)).toMatchObject({ kind: 'matched', span: { location: 'p. 2' } });
  });

  it('cuts a passage at whole words around what it found, and says the unit goes on', () => {
    const [passage] = searchUnits(UNITS, ['asunto']).passages;
    expect(passage).toMatchObject({ unit: 2, atStart: true, atEnd: false });
    expect(passage?.text.endsWith('ejemplo.') || passage?.text.endsWith('Relleno')).toBe(true);
    expect(passage?.text.length).toBeLessThan('Sin nada sobre el asunto.'.length + CONTEXT + 20);
  });

  it('shows a limited number of passages, and counts them all', () => {
    const { found, passages } = searchUnits(UNITS, ['relleno']);
    expect(found).toBe(1);
    expect(passages).toHaveLength(1);
    const many = Array.from({ length: MAX_PASSAGES + 5 }, (_, index) => ({
      index,
      label: `p. ${index + 1}`,
      body: 'Una página con la palabra clave.',
    }));
    const searched = searchUnits(many, ['clave']);
    expect([searched.found, searched.passages.length]).toEqual([MAX_PASSAGES + 5, MAX_PASSAGES]);
  });

  it('reads units whole, a few at a time, saying where to go on', () => {
    expect(readUnits(UNITS, 1, 1)).toEqual({
      units: [
        {
          index: 1,
          label: 'p. 2',
          text:
            'El Partido Ejemplo A propone una agencia de evaluación de sistemas de inteligencia artificial. ' +
            'También propone más bibliotecas.',
        },
      ],
      next: null,
    });
    const many = Array.from({ length: MAX_UNITS + 3 }, (_, index) => ({
      index,
      label: `p. ${index + 1}`,
      body: 'Página de ejemplo.',
    }));
    const read = readUnits(many, 0, 100);
    expect([read.units.length, read.next]).toEqual([MAX_UNITS, MAX_UNITS]);
  });
});
