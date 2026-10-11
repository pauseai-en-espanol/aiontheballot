import { palette } from '@aiontheballot/ui/brand';

/**
 * A party's colour, beside its name: decorative, never the only way a party is told apart. An SVG fill, not a style
 * attribute, so the page's CSP needs nothing for it. A party without a colour gets an empty square.
 */
export const PartySwatch = ({ colour }: { colour: string | null }) => (
  <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16">
    <rect
      x="0.75"
      y="0.75"
      width="14.5"
      height="14.5"
      fill={colour ?? palette.paper}
      stroke={palette.ink}
      strokeWidth="1.5"
    />
  </svg>
);
