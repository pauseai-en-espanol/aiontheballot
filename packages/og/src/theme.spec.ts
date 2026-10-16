import { describe, expect, it } from 'vitest';

import { cardTheme, DEFAULT_CARD_THEME } from './theme.js';

describe("a site's card colours (PLAN R178)", () => {
  it("are the platform's for a site without its own", () => {
    expect(cardTheme({})).toEqual(DEFAULT_CARD_THEME);
  });

  it('take the accent and the ink or paper that reads on it, never the canvas the ratings sit on', () => {
    expect(cardTheme({ accent: '#1d3557' })).toEqual({
      ...DEFAULT_CARD_THEME,
      accent: '#1d3557',
      onAccent: '#ffffff',
    });
    expect(cardTheme({ accent: '#ffd166' })).toMatchObject({
      accent: '#ffd166',
      onAccent: '#111111',
    });
  });
});
