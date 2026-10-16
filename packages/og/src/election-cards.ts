import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import type { CardTheme } from './theme.js';

import { h, img, type OgChild, type OgNode, type Style } from './node.js';
import { ratingIcon } from './rating-icon.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';

/**
 * The share cards of an election's public pages (PLAN, social sharing; R148) other than the data cards (data-cards.ts,
 * PLAN R185): a cell, the methodology and the corrections log. One frame for all, in the poster's direction (the
 * coming-soon card's): the site's name and the election on the theme's accent, the content on its canvas, then the
 * canonical address large, the methodology's short address and the operator small (BRIEF §3, invariant 4). Every text
 * comes from the site's data and the i18n messages, already in the page's language; colours from the theme passed in,
 * except the ratings', which are fixed. Ratings are always an icon and words together (BRIEF §6).
 */

/** What every election card shows around its content. */
export interface CardFrame {
  theme: CardTheme;
  /** The site's name: the product people share. */
  site: string;
  /** The election's name and date, one line. */
  election: string;
  /** The canonical address without the scheme: large on every card. */
  address: string;
  /** The methodology's short address, with its words: "Metodología: iaenlasurnas.es/…/metodologia". */
  methodology: string;
  /** "Una iniciativa de {operator}": the operator line when there is no logo. */
  initiative: string;
  /** "Una iniciativa de": before the operator's logo. */
  initiativeLead: string;
  /** The operator's logo for the accent colour, by content hash: part of the card's content, so of its hash. */
  operatorLogo?: { sha256: string; contentType: string };
  /** "Actualizado el …": the newest date of the ratings the card shows, when it shows any. */
  updated?: string;
}

/** One entry of the legend: an icon and its words. */
export interface LegendEntry {
  rating: RatingDisplay;
  label: string;
}

export interface CellCard extends CardFrame {
  /** The party's name. */
  party: string;
  partyLogo?: { sha256: string; contentType: string };
  /** The party's colour, when it has one (PLAN R178). */
  partyColour?: string;
  /** The criterion's title. */
  criterion: string;
  rating: RatingDisplay;
  ratingLabel: string;
  /** The rating's short summary, when it has one. */
  summary?: string;
  /** "Fuente: {title}", the first quote's source, when there is one. */
  source?: string;
}

export interface MethodologyCard extends CardFrame {
  /** "Metodología". */
  kicker: string;
  /** The methodology's lead: what the ratings say. */
  title: string;
  legend: LegendEntry[];
}

export interface CorrectionsCard extends CardFrame {
  /** "Registro de correcciones". */
  kicker: string;
  /** The election's name, or the log's title. */
  title: string;
  /** "12 cambios publicados; el último, el 3 de octubre". */
  summary: string;
}

/** The images a card draws, resolved from its content when it is rendered. */
export interface ElectionCardImages {
  operatorLogo?: { src: string; width: number; height: number };
  partyLogo?: { src: string; width: number; height: number };
  /** The parties' logos, in the parties' (or rows') order: none where a party has none, or its can't be read. */
  partyLogos?: ({ src: string; width: number; height: number } | undefined)[];
}

interface Layout {
  pad: number;
  /** Stories keep their top and bottom clear for the apps' own controls. */
  padTop: number;
  padBottom: number;
  site: number;
  election: number;
  panelPad: number;
  kicker: number;
  title: number;
  row: number;
  /** The rating's icon on a cell's card. */
  icon: number;
  summary: number;
  address: number;
  small: number;
  /** Rows side by side in a list. */
  columns: 1 | 2;
  /** Whether the footer's address and the operator sit side by side. */
  wide: boolean;
}

const LAYOUTS: Record<ShareSize, Layout> = {
  '1200x630': {
    pad: 40,
    padTop: 32,
    padBottom: 30,
    site: 30,
    election: 19,
    panelPad: 26,
    kicker: 17,
    title: 44,
    row: 19,
    icon: 64,
    summary: 21,
    address: 30,
    small: 16,
    columns: 2,
    wide: true,
  },
  '1080x1080': {
    pad: 56,
    padTop: 56,
    padBottom: 52,
    site: 42,
    election: 24,
    panelPad: 36,
    kicker: 22,
    title: 64,
    row: 25,
    icon: 110,
    summary: 28,
    address: 40,
    small: 21,
    columns: 1,
    wide: false,
  },
  '1080x1350': {
    pad: 64,
    padTop: 72,
    padBottom: 64,
    site: 46,
    election: 26,
    panelPad: 40,
    kicker: 24,
    title: 72,
    row: 27,
    icon: 130,
    summary: 30,
    address: 44,
    small: 23,
    columns: 1,
    wide: false,
  },
  '1080x1920': {
    pad: 72,
    padTop: 220,
    padBottom: 270,
    site: 50,
    election: 28,
    panelPad: 44,
    kicker: 26,
    title: 80,
    row: 29,
    icon: 150,
    summary: 32,
    address: 46,
    small: 25,
    columns: 1,
    wide: false,
  },
};

export const display = { fontFamily: 'Saira Condensed', fontWeight: 700 } as const;
/** Saira Condensed's characters average under half an em, Roboto Slab's about 0.55: estimates on the safe side. */
export const DISPLAY_EM = 0.5;

/** One line of text, cut with an ellipsis when it doesn't fit. */
export const oneLine = (style: Style, text: string): OgNode =>
  h(
    'div',
    {
      display: 'block',
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      ...style,
    },
    text,
  );

/** At most `lines` lines of text, the last cut with an ellipsis. */
export const clamped = (style: Style, text: string, lines: number): OgNode =>
  h('div', { display: 'block', lineClamp: lines, overflow: 'hidden', ...style }, text);

/** A title as big as it can be, up to the layout's size, on at most two lines of the content's width. */
export const titleSize = (text: string, max: number, width: number): number => {
  const perLine = Math.max(1, text.length / 2);
  return Math.floor(Math.min(max, Math.max(max * 0.55, width / (perLine * DISPLAY_EM))));
};

/** The rating's icon and words, side by side: never colour alone. */
export const ratingWords = (
  rating: RatingDisplay,
  label: string,
  size: number,
  theme: CardTheme,
): OgNode =>
  h(
    'div',
    { display: 'flex', alignItems: 'center', gap: size * 0.45, flexShrink: 0 },
    ratingIcon(rating, Math.round(size * 1.35)),
    h(
      'div',
      { ...display, display: 'flex', fontSize: size, color: theme.ink, textTransform: 'uppercase' },
      label,
    ),
  );

/** The legend: each rating's icon and words, wrapping. */
export const legend = (entries: LegendEntry[], size: number, theme: CardTheme): OgNode =>
  h(
    'div',
    { display: 'flex', flexWrap: 'wrap', columnGap: size * 1.4, rowGap: size * 0.7 },
    ...entries.map((entry) => ratingWords(entry.rating, entry.label, size, theme)),
  );

/** "Una iniciativa de" and the operator's logo, about two lines of text tall; or the line in words. */
export const operatorLine = (
  frame: CardFrame,
  images: ElectionCardImages,
  fontSize: number,
): OgNode => {
  const logo = images.operatorLogo;
  if (!frame.operatorLogo || !logo) {
    return oneLine({ fontSize, color: frame.theme.onAccent }, frame.initiative);
  }
  const height = Math.round(fontSize * 2.2);
  return h(
    'div',
    { display: 'flex', alignItems: 'center', gap: fontSize * 0.6, fontSize },
    frame.initiativeLead,
    img(logo.src, Math.round((height * logo.width) / logo.height), height),
  );
};

/**
 * The frame: the site and the election on the accent, the panel with the content on the canvas, and the footer. The
 * panel's content gets `content(width, height)`, its inner size, so lists can count what fits.
 */
const frame = (
  card: CardFrame,
  size: ShareSize,
  images: ElectionCardImages,
  content: (inner: { width: number; height: number; l: Layout }) => OgChild[],
): OgNode => {
  const { width, height } = SHARE_SIZES[size];
  const l = LAYOUTS[size];
  const { theme } = card;
  const headerHeight = l.site * 1.05 + l.election * 1.35 + 6;
  // The operator's line is a line of text, or a logo about two lines tall.
  const operatorHeight = card.operatorLogo && images.operatorLogo ? l.small * 2.3 : l.small * 1.4;
  const smallLines = l.small * 1.4 + 4 + operatorHeight;
  const footerHeight = l.wide
    ? Math.max(l.address * 1.25, smallLines)
    : l.address * 1.3 + 6 + smallLines;
  const gap = Math.round(l.small * 1.1);
  const panelHeight = height - l.padTop - l.padBottom - headerHeight - footerHeight - 2 * gap;
  const inner = {
    width: width - 2 * l.pad - 2 * l.panelPad,
    height: panelHeight - 2 * l.panelPad - (card.updated ? l.small * 1.6 : 0),
    l,
  };
  return h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      gap,
      width,
      height,
      padding: `${l.padTop}px ${l.pad}px ${l.padBottom}px`,
      backgroundColor: theme.accent,
      color: theme.onAccent,
      fontFamily: 'Roboto Slab',
    },
    // The site, with the pause sign, and the election.
    h(
      'div',
      { display: 'flex', flexDirection: 'column', height: headerHeight, flexShrink: 0 },
      h(
        'div',
        {
          ...display,
          display: 'flex',
          alignItems: 'center',
          gap: l.site * 0.3,
          fontSize: l.site,
          lineHeight: 1.05,
          textTransform: 'uppercase',
        },
        h(
          'div',
          { display: 'flex', gap: l.site * 0.14 },
          h('div', { width: l.site * 0.2, height: l.site * 0.7, backgroundColor: theme.onAccent }),
          h('div', { width: l.site * 0.2, height: l.site * 0.7, backgroundColor: theme.onAccent }),
        ),
        oneLine({}, card.site),
      ),
      oneLine({ fontSize: l.election, lineHeight: 1.35 }, card.election),
    ),
    h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        height: panelHeight,
        flexShrink: 0,
        padding: l.panelPad,
        backgroundColor: theme.canvas,
        color: theme.ink,
        overflow: 'hidden',
      },
      h(
        'div',
        { display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' },
        ...content(inner),
      ),
      ...(card.updated
        ? [
            oneLine(
              { fontSize: l.small, color: theme.muted, marginTop: l.small * 0.6 },
              card.updated,
            ),
          ]
        : []),
    ),
    // The address large, the methodology and the operator small.
    h(
      'div',
      {
        display: 'flex',
        flexDirection: l.wide ? 'row' : 'column',
        alignItems: l.wide ? 'flex-end' : 'flex-start',
        justifyContent: 'space-between',
        gap: l.wide ? 24 : 6,
        height: footerHeight,
        flexShrink: 0,
      },
      oneLine(
        { ...display, fontSize: l.address, lineHeight: 1.25, flexShrink: l.wide ? 1 : 0 },
        card.address,
      ),
      h(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          alignItems: l.wide ? 'flex-end' : 'flex-start',
          gap: 4,
          flexShrink: 0,
          fontSize: l.small,
        },
        oneLine({ fontSize: l.small }, card.methodology),
        operatorLine(card, images, l.small),
      ),
    ),
  );
};

/** A small line above a title: what the card is about. */
const kickerLine = (text: string, l: Layout, theme: CardTheme): OgNode =>
  oneLine(
    {
      ...display,
      fontSize: l.kicker,
      color: theme.muted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: l.kicker * 0.3,
    },
    text,
  );

const titleLine = (text: string, fontSize: number, theme: CardTheme): OgNode =>
  clamped(
    {
      ...display,
      fontSize,
      lineHeight: 1.0,
      color: theme.ink,
      textTransform: 'uppercase',
      marginBottom: fontSize * 0.3,
    },
    text,
    2,
  );

/**
 * A party's mark (PLAN R184, as on the site): its logo, without a frame, contained in a box of one size; without a
 * logo, a rounded square of its colour outlined in ink, with no mark (square, unlike the round rating icons); with
 * neither, the box left empty, so names in a list still line up. Never in a rating's place, never alone: the name is
 * always beside it.
 */
export const partyMark = (
  logo: { src: string; width: number; height: number } | undefined,
  colour: string | null | undefined,
  size: number,
  theme: CardTheme,
): OgNode => {
  const box = Math.round(size);
  const style = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: box,
    height: box,
    flexShrink: 0,
  };
  if (logo) {
    const scale = Math.min(box / logo.width, box / logo.height);
    return h(
      'div',
      style,
      img(
        logo.src,
        Math.max(1, Math.round(logo.width * scale)),
        Math.max(1, Math.round(logo.height * scale)),
      ),
    );
  }
  if (colour) {
    const square = Math.round(box * 0.8);
    return h(
      'div',
      style,
      h('div', {
        display: 'flex',
        width: square,
        height: square,
        backgroundColor: colour,
        border: `${Math.max(2, Math.round(box * 0.05))}px solid ${theme.ink}`,
        borderRadius: Math.round(square / 4),
      }),
    );
  }
  return h('div', style);
};

/**
 * A party's name with its colour as a thin line under it, as wide as the name (PLAN R184): it says "this is the
 * party" without looking like a rating. The name alone without a colour.
 */
export const nameWithLine = (
  name: OgNode,
  colour: string | null | undefined,
  size: number,
): OgNode => {
  if (!colour) {
    return name;
  }
  const line = Math.max(3, Math.round(size * 0.14));
  return h(
    'div',
    { display: 'flex', flexDirection: 'column', gap: Math.round(line * 1.2), minWidth: 0 },
    name,
    h('div', { display: 'flex', height: line, borderRadius: line, backgroundColor: colour }),
  );
};

/** A party's mark beside its name, with the colour line under the name (PLAN R184). */
const markedName = (
  name: OgNode,
  logo: ElectionCardImages['partyLogo'],
  colour: string | null | undefined,
  size: number,
  theme: CardTheme,
): OgNode =>
  logo || colour
    ? h(
        'div',
        { display: 'flex', alignItems: 'center', gap: size * 0.35, minWidth: 0 },
        partyMark(logo, colour, size * 1.3, theme),
        nameWithLine(name, colour, size),
      )
    : name;

export const cellCard = (
  card: CellCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  frame(card, size, images, ({ width, l }) => {
    const fontSize = titleSize(card.criterion, l.title * 0.8, width);
    return [
      markedName(
        oneLine(
          {
            ...display,
            fontSize: l.kicker * 1.15,
            color: card.theme.ink,
            textTransform: 'uppercase',
          },
          card.party,
        ),
        card.partyLogo ? images.partyLogo : undefined,
        card.partyColour,
        Math.round(l.kicker * 1.15),
        card.theme,
      ),
      h('div', { display: 'flex', height: l.kicker * 0.4 }),
      titleLine(card.criterion, fontSize, card.theme),
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: l.icon * 0.25,
          marginBottom: l.summary * 0.6,
        },
        ratingIcon(card.rating, l.icon),
        clamped(
          {
            ...display,
            fontSize: l.icon * 0.42,
            lineHeight: 1.0,
            color: card.theme.ink,
            textTransform: 'uppercase',
          },
          card.ratingLabel,
          2,
        ),
      ),
      ...(card.summary
        ? [
            clamped(
              { fontSize: l.summary, lineHeight: 1.35 },
              card.summary,
              l.columns === 2 ? 2 : 5,
            ),
          ]
        : []),
      ...(card.source
        ? [
            oneLine(
              { fontSize: l.small, color: card.theme.muted, marginTop: l.small * 0.6 },
              card.source,
            ),
          ]
        : []),
    ];
  });

export const methodologyCard = (
  card: MethodologyCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  frame(card, size, images, ({ width, l }) => {
    const fontSize = titleSize(card.title, l.title * 0.85, width);
    return [
      kickerLine(card.kicker, l, card.theme),
      titleLine(card.title, fontSize, card.theme),
      h('div', { display: 'flex', height: l.row * 0.6 }),
      legend(card.legend, l.row, card.theme),
    ];
  });

export const correctionsCard = (
  card: CorrectionsCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  frame(card, size, images, ({ width, l }) => {
    const fontSize = titleSize(card.title, l.title * 0.85, width);
    return [
      kickerLine(card.kicker, l, card.theme),
      titleLine(card.title, fontSize, card.theme),
      clamped({ fontSize: l.summary, lineHeight: 1.35 }, card.summary, 3),
    ];
  });
