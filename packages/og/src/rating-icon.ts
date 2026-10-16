import { palette } from '@aiontheballot/ui/brand';
import { RATING_VISUALS, type RatingDisplay } from '@aiontheballot/ui/ratings';

import { img, type OgNode } from './node.js';

/**
 * A rating's icon as an SVG, the same drawing as the public pages' (apps/web components/rating.tsx): a shape per place
 * on the scale, filled with its fixed colour and outlined in ink, so it reads without colour. Never themed: a rating
 * looks the same on every site and every card (BRIEF §3).
 */
export const ratingIconSvg = (rating: RatingDisplay): string => {
  const { shape, fill, mark } = RATING_VISUALS[rating];
  const ring =
    `<circle cx="12" cy="12" r="10.5" fill="${fill ?? palette.paper}" stroke="${palette.ink}" stroke-width="1.5"` +
    `${fill === null ? ' stroke-dasharray="3 2.2"' : ''}/>`;
  const stroke = (d: string) =>
    `<path d="${d}" fill="none" stroke="${mark}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const marks: Record<typeof shape, string> = {
    tick: stroke('M7 12.5l3.3 3.3L17 9'),
    half: `<path d="M12 4a8 8 0 0 0 0 16z" fill="${mark}"/>`,
    cross: stroke('M8 8l8 8M16 8l-8 8'),
    none: stroke('M7.5 16.5l9-9'),
    pending: [8, 12, 16].map((x) => `<circle cx="${x}" cy="12" r="1.5" fill="${mark}"/>`).join(''),
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${ring}${marks[shape]}</svg>`;
};

/** The icon at `size` pixels, for a card. */
export const ratingIcon = (rating: RatingDisplay, size: number): OgNode =>
  img(
    `data:image/svg+xml;base64,${Buffer.from(ratingIconSvg(rating)).toString('base64')}`,
    size,
    size,
  );
