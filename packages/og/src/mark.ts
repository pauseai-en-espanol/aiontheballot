import {
  ballotBox,
  ballotBoxPaint,
  ballotBoxSvg,
  type MarkLetters,
} from '@aiontheballot/ui/ballot-box';

import type { CardTheme } from './theme.js';

import { img, type OgNode } from './node.js';

/**
 * The site's mark (PLAN R238) in a share image, `height` pixels tall, in the card's theme: the ballot on its canvas,
 * printed in its ink, the box in the colour on its accent, as on the page. An SVG image, which resvg draws as shapes.
 */
export const markImage = (
  variant: 'hero' | 'compact',
  letters: MarkLetters,
  theme: CardTheme,
  height: number,
): OgNode => {
  const drawing = ballotBox(variant, letters);
  const svg = ballotBoxSvg(
    drawing,
    ballotBoxPaint({ canvas: theme.canvas, ink: theme.ink, onAccent: theme.onAccent }),
  );
  return img(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    Math.round((height * drawing.width) / drawing.height),
    height,
  );
};
