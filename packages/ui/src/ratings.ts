import { palette } from './brand.js';

/**
 * The fixed rating language (BRIEF §6; CLAUDE.md): a rating is always an icon, its words and a colour together, never
 * colour alone. The icons differ in shape (a tick, a half, a cross, a slashed circle, three dots), so they read in
 * greyscale and to anyone who can't tell the colours apart; every icon has an ink outline, so its shape keeps 3:1
 * against the page (WCAG 1.4.11) whatever its fill; the mark inside has 3:1 against the fill. Share images draw the same
 * shapes from these values, so a rating looks the same everywhere. No tenant setting changes them (BRIEF §3).
 */
export const RATING_SHAPES = ['tick', 'half', 'cross', 'none', 'pending'] as const;
export type RatingShape = (typeof RATING_SHAPES)[number];

export interface RatingVisual {
  shape: RatingShape;
  /** The circle's fill; `null` for an outline only (pending). */
  fill: string | null;
  /** The mark inside: ink or paper, whichever stands out on the fill. */
  mark: string;
}

/** The rating colours: fills, never text. */
export const ratingPalette = {
  positive: '#1E7B3C',
  middle: '#F2B400',
  negative: '#C42B1C',
  silent: '#6B6B6B',
} as const;

/** By rating value (`app.rating`), plus `pending` and `withdrawn`, which are display states, not ratings. */
export const RATING_VISUALS = {
  meets: { shape: 'tick', fill: ratingPalette.positive, mark: palette.paper },
  partially_meets: { shape: 'half', fill: ratingPalette.middle, mark: palette.ink },
  does_not_meet: { shape: 'cross', fill: ratingPalette.negative, mark: palette.paper },
  green: { shape: 'tick', fill: ratingPalette.positive, mark: palette.paper },
  yellow: { shape: 'half', fill: ratingPalette.middle, mark: palette.ink },
  red: { shape: 'cross', fill: ratingPalette.negative, mark: palette.paper },
  not_mentioned: { shape: 'none', fill: ratingPalette.silent, mark: palette.paper },
  pending: { shape: 'pending', fill: null, mark: palette.ink },
  withdrawn: { shape: 'pending', fill: null, mark: palette.ink },
} as const satisfies Record<string, RatingVisual>;

export type RatingDisplay = keyof typeof RATING_VISUALS;
