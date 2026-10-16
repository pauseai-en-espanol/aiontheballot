import { matchQuote } from '@aiontheballot/domain/quote-match';
import { describe, expect, it } from 'vitest';

import { MAX_SECTION_LABEL, pickQuote } from './pick';

// Fictional pages, as an extraction labels them.
const UNITS = [
  {
    label: 'p. 1',
    body: 'El Partido Ejemplo A propone una moratoria\nficticia sobre los sistemas de prueba.',
  },
  { label: 'p. 2', body: 'También pide crear una agencia de super-\nvisión de ejemplo.' },
  { label: 'p. 3', body: 'Un presupuesto inventado cierra el programa.' },
];
const sourceUnits = UNITS.map((unit, index) => ({ ...unit, index: index + 1 }));

const part = (unit: number, from: string, to?: string) => {
  const body = UNITS[unit]?.body ?? '';
  const start = body.indexOf(from);
  return { unit, from: start, to: to === undefined ? body.length : body.indexOf(to) + to.length };
};

describe('pickQuote', () => {
  it('takes the passage as it is in the text, line breaks included, with its page', () => {
    const picked = pickQuote(UNITS, [part(0, 'propone', 'prueba.')]);
    expect(picked).toEqual({
      kind: 'picked',
      quote: 'propone una moratoria\nficticia sobre los sistemas de prueba.',
      label: 'p. 1',
    });
  });

  it('joins pages with one space and names the span, as the match does', () => {
    const picked = pickQuote(UNITS, [part(0, 'sistemas'), part(1, 'También', 'agencia')]);
    expect(picked).toEqual({
      kind: 'picked',
      quote: 'sistemas de prueba. También pide crear una agencia',
      label: 'p. 1–p. 2',
    });
  });

  it('always picks something the live match finds where the selection was', () => {
    for (const parts of [
      [part(0, 'moratoria', 'sistemas')],
      [part(1, 'agencia', 'ejemplo.')],
      [part(0, 'prueba'), part(1, 'También'), part(2, 'Un', 'presupuesto')],
      [part(1, 'una agencia', 'visión')],
    ]) {
      const picked = pickQuote(UNITS, parts);
      if (picked.kind !== 'picked') {
        throw new Error(`Nothing picked from ${JSON.stringify(parts)}`);
      }
      expect(matchQuote(picked.quote, sourceUnits)).toMatchObject({
        kind: 'matched',
        span: { location: picked.label },
      });
    }
  });

  it('leaves out blanks at either end, and pages it took only blanks from', () => {
    const body = UNITS[0]?.body ?? '';
    const picked = pickQuote(UNITS, [
      { unit: 0, from: body.indexOf('\nficticia'), to: body.length },
      { unit: 1, from: 0, to: 0 },
      { unit: 2, from: 0, to: 0 },
    ]);
    expect(picked).toEqual({
      kind: 'picked',
      quote: 'ficticia sobre los sistemas de prueba.',
      label: 'p. 1',
    });
    expect(pickQuote(UNITS, [{ unit: 0, from: 42, to: 43 }])).toEqual({ kind: 'empty' });
    expect(pickQuote(UNITS, [])).toEqual({ kind: 'empty' });
  });

  it('ignores parts that name no unit, in whatever order they come', () => {
    expect(pickQuote(UNITS, [part(1, 'También', 'agencia'), { unit: 9, from: 0, to: 4 }])).toEqual({
      kind: 'picked',
      quote: 'También pide crear una agencia',
      label: 'p. 2',
    });
    expect(pickQuote(UNITS, [part(1, 'También', 'pide'), part(0, 'prueba.')])).toMatchObject({
      quote: 'prueba. También pide',
      label: 'p. 1–p. 2',
    });
  });

  it('refuses more than a quote may have, counted as the database counts', () => {
    const long = [{ label: 'p. 1', body: '🗳'.repeat(1001) }];
    expect(pickQuote(long, [{ unit: 0, from: 0, to: 2002 }])).toEqual({
      kind: 'too-long',
      length: 1001,
    });
    // 1,000 characters are 2,000 UTF-16 units here, and still a quote.
    expect(pickQuote(long, [{ unit: 0, from: 0, to: 2000 }])).toMatchObject({ kind: 'picked' });
  });

  it('keeps the page within what its field takes', () => {
    const units = [
      { label: 'A'.repeat(150), body: 'Primera sección de un sitio web de ejemplo.' },
      { label: 'B'.repeat(150), body: 'Segunda sección de un sitio web de ejemplo.' },
    ];
    const picked = pickQuote(units, [
      { unit: 0, from: 0, to: 10 },
      { unit: 1, from: 0, to: 10 },
    ]);
    expect(picked.kind === 'picked' && Array.from(picked.label).length).toBe(MAX_SECTION_LABEL);
  });
});
