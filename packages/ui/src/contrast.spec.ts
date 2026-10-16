import { describe, expect, it } from 'vitest';

import { palette, roles, textOn } from './brand.js';
import { AA_TEXT, contrastRatio, luminance } from './contrast.js';

describe('contrastRatio', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio(palette.orange, palette.ink)).toBe(
      contrastRatio(palette.ink, palette.orange),
    );
  });

  it('refuses anything but #rrggbb', () => {
    expect(() => luminance('orange')).toThrow('Not a #rrggbb colour');
    expect(() => luminance('#fff')).toThrow('Not a #rrggbb colour');
  });
});

describe('brand colours', () => {
  const pairs = Object.entries(textOn).flatMap(([bg, fgs]) =>
    fgs.map((fg) => [fg, bg as keyof typeof roles.bg] as const),
  );

  it.each(pairs)('text %s on %s meets WCAG AA', (fg, bg) => {
    expect(contrastRatio(roles.fg[fg], roles.bg[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('never uses orange for text on a light background, where it fails AA', () => {
    expect(contrastRatio(palette.orange, palette.paper)).toBeLessThan(AA_TEXT);
    const onLight = [...textOn.canvas, ...textOn.subtle].map((fg) => roles.fg[fg]);
    expect(onLight).not.toContain(palette.orange);
  });

  it('gives every text colour a background', () => {
    const used = new Set<string>(Object.values(textOn).flat());
    expect(Object.keys(roles.fg).filter((fg) => !used.has(fg))).toEqual([]);
  });
});
