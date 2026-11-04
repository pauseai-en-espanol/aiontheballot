/** sin 45° and cos 45°: how far up, and how far along, a title tilted at 45° reaches for each unit of its length. */
const TILT = Math.SQRT1_2;

/**
 * The narrowest a summary's column gets, in `ch` of its titles' type (38 px on a phone, rating-summary.tsx): the
 * narrower it is taken to be, the more room is kept, so a title is never cut.
 */
const NARROWEST_COLUMN = 4;

/** Characters as a reader sees them: an accented letter or an emoji is one, however many code points it takes. */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The room a summary's criteria titles need when each is tilted at 45°, rising to the inline end from the middle of
 * its column (rating-summary.tsx), in `ch` of their type, from their lengths in characters: `ch` (a zero's width) is
 * wider than most letters, so the room is a little more than they take, never less. `rise` is how tall the header row
 * must be for the longest title; `overhang` is how far past the last column's edge any title reaches, which the table
 * leaves free at its end so the scroll region never cuts one.
 */
export const tiltedHeaderRoom = (titles: readonly string[]): { rise: number; overhang: number } => {
  const lengths = titles.map((title) => Array.from(graphemes.segment(title)).length);
  const columnsAfter = (index: number) => lengths.length - 1 - index;
  return {
    rise: Math.ceil(Math.max(0, ...lengths) * TILT),
    overhang: Math.ceil(
      Math.max(
        0,
        ...lengths.map(
          (length, index) => length * TILT - (columnsAfter(index) + 0.5) * NARROWEST_COLUMN,
        ),
      ),
    ),
  };
};
