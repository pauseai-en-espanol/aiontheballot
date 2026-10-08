import { describe, expect, it } from 'vitest';

import {
  isMethodologyKind,
  isRating,
  isValidRating,
  RATING_SCALES,
  RATINGS,
} from './methodology.js';

describe('rating scales', () => {
  it('uses only known ratings in every scale', () => {
    for (const scale of Object.values(RATING_SCALES)) {
      for (const rating of scale) {
        expect(RATINGS).toContain(rating);
      }
    }
  });

  it('covers every rating with at least one scale', () => {
    const used = new Set(Object.values(RATING_SCALES).flat());
    expect([...used].sort()).toEqual([...RATINGS].sort());
  });

  it('lets both kinds rate "not mentioned"', () => {
    expect(isValidRating('demands', 'not_mentioned')).toBe(true);
    expect(isValidRating('descriptive', 'not_mentioned')).toBe(true);
  });

  it('rejects ratings from the other kind', () => {
    expect(isValidRating('demands', 'green')).toBe(false);
    expect(isValidRating('descriptive', 'meets')).toBe(false);
  });
});

describe('guards', () => {
  it('recognises valid values', () => {
    expect(isRating('partially_meets')).toBe(true);
    expect(isMethodologyKind('descriptive')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isRating('excellent')).toBe(false);
    expect(isRating(undefined)).toBe(false);
    expect(isMethodologyKind('scored')).toBe(false);
  });
});
