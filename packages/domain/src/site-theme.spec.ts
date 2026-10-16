import { describe, expect, it } from 'vitest';

import {
  AA_TEXT,
  contrastRatio,
  readableText,
  readTheme,
  THEME_TEXTS,
  themeColourProblem,
} from './site-theme.js';

describe("a site's colours (editorial workflow T1, PLAN R178)", () => {
  it('carry ink or paper, whichever reads better', () => {
    expect(readableText('#ff9416')).toMatchObject({ text: '#111111' });
    expect(readableText('#1d3557')).toMatchObject({ text: '#ffffff' });
    for (const colour of ['#ff9416', '#1d3557', '#ffffff', '#000000', '#2a9d8f']) {
      const { text, ratio } = readableText(colour);
      expect(THEME_TEXTS).toContain(text);
      expect(ratio).toBe(Math.max(...THEME_TEXTS.map((t) => contrastRatio(t, colour))));
    }
  });

  it('refuse a colour on which neither reads at WCAG AA: a middle grey', () => {
    expect(contrastRatio('#111111', '#7a7a7a')).toBeLessThan(AA_TEXT);
    expect(contrastRatio('#ffffff', '#7a7a7a')).toBeLessThan(AA_TEXT);
    expect(themeColourProblem('accent', '#7a7a7a')).toBe('contrast');
    expect(themeColourProblem('accent', '#1d3557')).toBeUndefined();
  });

  it('take only the names the site uses, as #rrggbb in lowercase, as the database stores them', () => {
    expect(themeColourProblem('accent', '#ff9416')).toBeUndefined();
    expect(themeColourProblem('background', '#ff9416')).toBe('unknown');
    for (const value of ['#FF9416', '#f94', 'orange', '', 12, null]) {
      expect(themeColourProblem('accent', value), String(value)).toBe('format');
    }
  });

  it('leave anything they can not draw to the platform colour', () => {
    expect(readTheme({ accent: '#1d3557' })).toEqual({ accent: '#1d3557' });
    expect(readTheme({ accent: '#7a7a7a', other: '#000000' })).toEqual({});
    for (const value of [null, [], 'accent', 3]) {
      expect(readTheme(value)).toEqual({});
    }
  });
});
