/** Methodology kinds and their rating scales (BRIEF §3). Labels and icons live in @ballot/i18n and the UI. */

export const METHODOLOGY_KINDS = ['demands', 'descriptive'] as const;
export type MethodologyKind = (typeof METHODOLOGY_KINDS)[number];

/** Every rating value. Must match the `app.rating` enum in the database. */
export const RATINGS = [
  'meets',
  'partially_meets',
  'does_not_meet',
  'green',
  'yellow',
  'red',
  'not_mentioned',
] as const;
export type Rating = (typeof RATINGS)[number];

/** The ratings valid for each methodology kind, in display order. */
export const RATING_SCALES = {
  demands: ['meets', 'partially_meets', 'does_not_meet', 'not_mentioned'],
  descriptive: ['green', 'yellow', 'red', 'not_mentioned'],
} as const satisfies Record<MethodologyKind, readonly Rating[]>;

export const isMethodologyKind = (value: unknown): value is MethodologyKind =>
  typeof value === 'string' && (METHODOLOGY_KINDS as readonly string[]).includes(value);

export const isRating = (value: unknown): value is Rating =>
  typeof value === 'string' && (RATINGS as readonly string[]).includes(value);

/** Whether `rating` belongs to the scale of `kind`. The database enforces the same rule with a trigger. */
export const isValidRating = (kind: MethodologyKind, rating: Rating): boolean =>
  (RATING_SCALES[kind] as readonly Rating[]).includes(rating);
