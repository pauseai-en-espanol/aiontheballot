import { describe, expect, it } from 'vitest';

import { h } from './node.js';
import { renderSvg } from './render.js';
import { type CardFont, textWidth } from './text-width.js';

/** How wide satori lays `text` out on one line: where a marker drawn right after it starts. */
const laidOut = async (text: string, size: number, font: CardFont): Promise<number> => {
  const node = h(
    'div',
    { display: 'flex', width: 1200, height: 630 },
    h(
      'div',
      {
        fontFamily: font,
        fontWeight: font === 'Saira Condensed' ? 700 : 400,
        fontSize: size,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      text,
    ),
    h('div', { width: 1, height: 1, backgroundColor: '#ff0000', flexShrink: 0 }),
  );
  const svg = await renderSvg(node, '1200x630');
  const marker = /<rect x="([\d.]+)"[^>]*fill="#ff0000"/.exec(svg);
  if (!marker?.[1]) {
    throw new Error(`No marker after "${text}"`);
  }
  return Number(marker[1]);
};

/** Invented texts: lower case and capitals, accents, punctuation, the widest letters and the narrowest. */
const TEXTS = [
  'Criterio de ejemplo uno',
  'Investigación de ejemplo',
  'PENDIENTE DE EVALUAR',
  'Ñandú · «Pingüino» 2026',
  'WWWWWWWWWW',
  'iiiiiiiiii',
];
/** Pairs the fonts kern tight, one after another: drawn narrower than their letters' advances. */
const KERNED = 'AVATAR Tô Wa Yo';
const FONTS = ['Saira Condensed', 'Roboto Slab'] as const;

describe('a line of text measured in the embedded fonts', () => {
  it.each(FONTS)(
    'is as wide as satori draws it in %s: within 3% and 2 px',
    async (font) => {
      for (const text of TEXTS) {
        for (const size of [20, 40]) {
          const drawn = await laidOut(text, size, font);
          expect(
            Math.abs(textWidth(text, size, font) - drawn),
            `${font} ${size}px "${text}"`,
          ).toBeLessThanOrEqual(drawn * 0.03 + 2);
        }
      }
    },
    30_000,
  );

  it.each(FONTS)(
    'with what the cards allow over it, is never short of the text in %s, kerned tight or not',
    async (font) => {
      for (const text of [...TEXTS, KERNED]) {
        for (const size of [20, 40]) {
          // As data-cards.ts allows: the measure, 3% and 2 px over.
          expect(
            textWidth(text, size, font) * 1.03 + 2,
            `${font} ${size}px "${text}"`,
          ).toBeGreaterThanOrEqual(await laidOut(text, size, font));
        }
      }
    },
    30_000,
  );

  it('counts an accented letter once, however it is written', () => {
    expect(textWidth('Formación', 20, 'Saira Condensed')).toBe(
      // An o, then a combining acute accent.
      textWidth('Formacio\u0301n', 20, 'Saira Condensed'),
    );
  });

  it('counts a character the font lacks as an em', () => {
    expect(textWidth('中', 30, 'Roboto Slab')).toBe(30);
    expect(textWidth('a中', 30, 'Saira Condensed')).toBe(
      textWidth('a', 30, 'Saira Condensed') + 30,
    );
  });

  it('grows with the size', () => {
    expect(textWidth('Ejemplo', 40, 'Roboto Slab')).toBeCloseTo(
      2 * textWidth('Ejemplo', 20, 'Roboto Slab'),
    );
  });
});
