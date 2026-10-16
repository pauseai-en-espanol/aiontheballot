import { palette } from '@aiontheballot/ui/brand';
import { RATING_VISUALS, type RatingDisplay } from '@aiontheballot/ui/ratings';
import { css, cx } from '@styled-system/css';

/**
 * A rating's icon (BRIEF §6): a shape per place on the scale, filled with its colour and outlined in ink, so it reads
 * without colour. Decorative beside the rating's words, which always come with it (RatingBadge).
 */
export const RatingIcon = ({ rating, size = 22 }: { rating: RatingDisplay; size?: number }) => {
  const { shape, fill, mark } = RATING_VISUALS[rating];
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={css({ flexShrink: '0' })}
    >
      <circle
        cx="12"
        cy="12"
        r="10.5"
        fill={fill ?? palette.paper}
        stroke={palette.ink}
        strokeWidth="1.5"
        strokeDasharray={fill === null ? '3 2.2' : undefined}
      />
      {shape === 'tick' && (
        <path
          d="M7 12.5l3.3 3.3L17 9"
          fill="none"
          stroke={mark}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {shape === 'half' && <path d="M12 4a8 8 0 0 0 0 16z" fill={mark} />}
      {shape === 'cross' && (
        <path
          d="M8 8l8 8M16 8l-8 8"
          fill="none"
          stroke={mark}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      )}
      {shape === 'none' && (
        <path d="M7.5 16.5l9-9" fill="none" stroke={mark} strokeWidth="2.6" strokeLinecap="round" />
      )}
      {shape === 'pending' &&
        [8, 12, 16].map((x) => <circle key={x} cx={x} cy="12" r="1.5" fill={mark} />)}
    </svg>
  );
};

/** A rating in full: its icon and its words, side by side; colour is never all there is (BRIEF §6). */
export const RatingBadge = ({
  rating,
  label,
  className,
}: {
  rating: RatingDisplay;
  label: string;
  className?: string;
}) => (
  <span
    data-rating={rating}
    className={cx(
      css({ display: 'inline-flex', alignItems: 'center', gap: '8px', lineHeight: '1.25' }),
      className,
    )}
  >
    <RatingIcon rating={rating} />
    <span>{label}</span>
  </span>
);
