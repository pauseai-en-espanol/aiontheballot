import type { PublicParty } from '@aiontheballot/domain/public-election';
import type { ReactNode } from 'react';

import { palette } from '@aiontheballot/ui/brand';
import { css, cx } from '@styled-system/css';

import { brandImagePath } from '@/brand-images';

/** The box a party's mark sits in, one size for every party, so names line up whatever each has. */
const BOX = { small: 30, large: 64 } as const;
/** The colour line under a name: thin in a list, a little thicker under a page's heading. */
const LINE = { small: 4, large: 6 } as const;

/** The line's place under a mark, kept whether it has one or not (Panda needs each size's class written out). */
const LINE_SLOT = {
  small: css({ display: 'block', alignSelf: 'stretch', height: '4px' }),
  large: css({ display: 'block', alignSelf: 'stretch', height: '6px' }),
} as const;

/** The line of a party's colour, as wide as what it sits under and never wider. */
const ColourLine = ({ colour, height }: { colour: string; height: number }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    height={height}
    preserveAspectRatio="none"
    // No width of its own to add to what it sits under.
    className={css({ display: 'block', width: '0', minWidth: '100%' })}
  >
    <rect width="100%" height={height} rx={height / 2} fill={colour} />
  </svg>
);

/**
 * A party's mark (PLAN R184; the canvas's "Logo y color: hoy y con la propuesta"): its logo, without a frame, contained
 * in a box of one size; without a logo, a rounded square of its colour outlined in ink, with no mark (square, unlike
 * the round rating icons); with neither, the box stays empty, so names in a list still line up. Decorative (`alt=""`):
 * the name is always beside it. SVG fills, not style attributes, so the page's CSP needs nothing for the colour.
 * `line`: where the name beside it is an underlined link, the colour's line goes under a logo instead of under the
 * name, where it would read as a second underline; its place is kept under every mark, so they all stand alike.
 */
export const PartyMark = ({
  party,
  root,
  size = 'small',
  line = false,
}: {
  party: Pick<PublicParty, 'logo' | 'colour'>;
  /** The site's root, which the brand route sits under. */
  root: string;
  size?: keyof typeof BOX;
  line?: boolean;
}) => {
  const box = BOX[size];
  const path = party.logo ? brandImagePath(party.logo) : undefined;
  const square = Math.round(box * 0.8);
  const mark = path ? (
    // A plain img: a small logo the brand route serves once, cached for a year; nothing for next/image to do.
    // oxlint-disable-next-line next/no-img-element
    <img
      src={`${root}${path}`}
      alt=""
      width={box}
      height={box}
      className={css({ objectFit: 'contain', display: 'block' })}
      loading={size === 'small' ? 'lazy' : 'eager'}
    />
  ) : (
    <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} focusable="false">
      {party.colour ? (
        <rect
          x={(box - square) / 2 + 0.75}
          y={(box - square) / 2 + 0.75}
          width={square - 1.5}
          height={square - 1.5}
          rx={Math.round(square / 4)}
          fill={party.colour}
          stroke={palette.ink}
          strokeWidth="1.5"
        />
      ) : null}
    </svg>
  );
  return (
    <span
      aria-hidden="true"
      className={css({
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        flexShrink: '0',
      })}
    >
      {mark}
      {line ? (
        // Under a logo only: without one, the square already is the colour.
        <span className={LINE_SLOT[size]}>
          {path && party.colour ? <ColourLine colour={party.colour} height={LINE[size]} /> : null}
        </span>
      ) : null}
    </span>
  );
};

/**
 * A party's name with its colour as a thin line under it (PLAN R184): it says "this is the party" without looking like
 * a rating. No line without a colour. Only where the name isn't an underlined link (a party's page): beside a link,
 * the line goes under the mark (`PartyMark`'s `line`).
 */
export const PartyName = ({
  colour,
  size = 'small',
  className,
  children,
}: {
  colour: string | null;
  size?: keyof typeof LINE;
  className?: string;
  children: ReactNode;
}) => {
  const line = LINE[size];
  return (
    <span
      className={cx(
        css({
          display: 'inline-flex',
          flexDirection: 'column',
          gap: size === 'small' ? '6px' : '8px',
        }),
        className,
      )}
    >
      <span>{children}</span>
      {colour ? <ColourLine colour={colour} height={line} /> : null}
    </span>
  );
};
