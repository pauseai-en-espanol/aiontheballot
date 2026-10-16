import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import { ratingIconSvg } from '@aiontheballot/og/rating-icon';

import * as styles from './styles';

/**
 * A rating's icon in the admin (editorial workflow §2.5): the drawing the public pages and share cards use (a shape per
 * place on the scale, its fixed colour, an ink outline), so a rating looks the same everywhere. An image of the SVG,
 * decorative: the rating's words always come with it (RatingBadge), so it is never told by colour or shape alone.
 */
export const RatingIcon = ({ rating, size = 20 }: { rating: RatingDisplay; size?: number }) => (
  // oxlint-disable-next-line next/no-img-element
  <img
    className={styles.ratingIcon}
    alt=""
    width={size}
    height={size}
    src={`data:image/svg+xml,${encodeURIComponent(ratingIconSvg(rating))}`}
  />
);

/** A rating in full: its icon and its words, side by side. */
export const RatingBadge = ({ rating, label }: { rating: RatingDisplay; label: string }) => (
  <span className={styles.ratingBadge} data-rating={rating}>
    <RatingIcon rating={rating} />
    <span>{label}</span>
  </span>
);
