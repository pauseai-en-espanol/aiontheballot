import { describe, expect, it } from 'vitest';

import { shownRatio } from './shown-ratio';

describe("the colour form's contrast ratio (PLAN R178)", () => {
  it("is written in the page's language, with one decimal", () => {
    expect(shownRatio(12.63, 'es')).toBe('12,6');
    expect(shownRatio(12.63, 'en')).toBe('12.6');
    expect(shownRatio(21, 'es')).toBe('21,0');
  });

  it('is rounded down, so a colour just short of AA never shows the 4.5 it is refused for', () => {
    expect(shownRatio(4.4999, 'en')).toBe('4.4');
    expect(shownRatio(4.5, 'en')).toBe('4.5');
  });
});
