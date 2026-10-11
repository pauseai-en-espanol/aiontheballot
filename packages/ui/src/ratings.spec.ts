import { RATING_SCALES, RATINGS } from '@aiontheballot/domain/methodology';
import { describe, expect, it } from 'vitest';

import { palette } from './brand.js';
import { contrastRatio } from './contrast.js';
import { RATING_VISUALS } from './ratings.js';

/** WCAG 1.4.11: the parts of a graphic needed to understand it, 3:1 against what they sit on. */
const NON_TEXT = 3;

describe('the rating visuals', () => {
  it('cover every rating, and the pending and withdrawn display states', () => {
    expect(Object.keys(RATING_VISUALS).sort()).toEqual([...RATINGS, 'pending', 'withdrawn'].sort());
  });

  it.each(Object.entries(RATING_VISUALS))(
    '%s: its mark stands out from its fill',
    (_rating, visual) => {
      expect(contrastRatio(visual.mark, visual.fill ?? palette.paper)).toBeGreaterThanOrEqual(
        NON_TEXT,
      );
    },
  );

  it('give each place on a scale its own shape, so no rating is told by colour alone', () => {
    for (const scale of Object.values(RATING_SCALES)) {
      const shapes = [...scale, 'pending' as const].map((rating) => RATING_VISUALS[rating].shape);
      expect(new Set(shapes).size, scale.join()).toBe(shapes.length);
    }
  });

  it("keep the scales' places alike: a demands rating looks like its descriptive counterpart", () => {
    RATING_SCALES.demands.forEach((rating, index) => {
      expect(RATING_VISUALS[rating]).toEqual(RATING_VISUALS[RATING_SCALES.descriptive[index]!]);
    });
  });
});
