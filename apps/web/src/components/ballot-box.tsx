import {
  ballotBox,
  type BallotBoxRole,
  type BallotBoxShape,
  type MarkLetters,
} from '@aiontheballot/ui/ballot-box';
import { css } from '@styled-system/css';

/**
 * Each role's colour on the accent, as the preset names them, so a site's own colours (PLAN R178) reach the mark too:
 * the ballot on the canvas, printed in the text colour, the box in the colour on the accent. Classes, not style
 * attributes: the cached public site's CSP has no nonces (ADR-0003).
 */
const FILL: Record<BallotBoxRole, string> = {
  paper: css({ fill: 'bg.canvas' }),
  mark: css({ fill: 'fg.default' }),
  faded: css({ fill: 'fg.default', opacity: '0.35' }),
  box: css({ fill: 'bg.onAccent' }),
  glass: css({ fill: 'bg.onAccent', opacity: '0.25' }),
};
const STROKE: Record<BallotBoxRole, string> = {
  paper: css({ fill: 'none', stroke: 'bg.canvas' }),
  mark: css({ fill: 'none', stroke: 'fg.default' }),
  faded: css({ fill: 'none', stroke: 'fg.default', opacity: '0.35' }),
  box: css({ fill: 'none', stroke: 'bg.onAccent' }),
  glass: css({ fill: 'none', stroke: 'bg.onAccent', opacity: '0.25' }),
};

const Shape = ({ shape }: { shape: BallotBoxShape }) =>
  shape.kind === 'path' ? (
    <path d={shape.d} fillRule="evenodd" className={FILL[shape.role]} />
  ) : (
    <rect
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rx={shape.rx}
      strokeWidth={shape.stroke}
      className={shape.stroke === undefined ? FILL[shape.role] : STROKE[shape.role]}
    />
  );

/**
 * The site's mark (PLAN R238): a ballot marked with the letters for AI going into a transparent ballot box. Decorative:
 * the site's name is always beside it. `hero` on the coming-soon page, `compact` beside the name in the header.
 */
export const BallotBox = ({
  variant,
  letters,
  className,
}: {
  variant: 'hero' | 'compact';
  letters: MarkLetters;
  className?: string;
}) => {
  const drawing = ballotBox(variant, letters);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      className={className}
    >
      {drawing.shapes.map((shape, index) => (
        // The drawing's shapes never reorder: their place is their identity.
        // oxlint-disable-next-line react/no-array-index-key
        <Shape key={index} shape={shape} />
      ))}
    </svg>
  );
};
