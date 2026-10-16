import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import type { CardTheme } from './theme.js';

import {
  type CardFrame,
  clamped,
  display,
  DISPLAY_EM,
  type ElectionCardImages,
  legend,
  type LegendEntry,
  nameWithLine,
  oneLine,
  operatorLine,
  partyMark,
  ratingWords,
} from './election-cards.js';
import { h, type OgChild, type OgNode } from './node.js';
import { ratingIcon } from './rating-icon.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';

/**
 * The data cards (PLAN R185; the canvas's boards A to D, "data first"): the scorecard's link preview (A, every party's
 * rating on every criterion), the whole table (B), a party (C) and a criterion (D). The question or the subject leads,
 * large, on the site's accent; the data fills the canvas; the footer carries the data's date and the site's address,
 * large, with the methodology's short address. The site's name and the operator stay in the header (BRIEF §3,
 * invariant 4). Parties in the site's order, never ranked or totalled; a rating is always its icon, and its words
 * beside it or in the legend (BRIEF §6). Every text comes from the site's data and the i18n messages.
 */

/** A party as the data cards name it: short, in full, and its colour (its logo is the card's `partyLogos`). */
export interface CardParty {
  short: string;
  name: string;
  colour: string | null;
}

/** A rating in a grid: its icon, and its words where the card has room for them. */
export interface CardRating {
  rating: RatingDisplay;
  label: string;
}

/** What the data cards add to every card's frame. */
export interface DataFrame extends CardFrame {
  /** "Datos del 14 de octubre de 2026": the newest shown rating's date, or that none is published yet. */
  dataDate: string;
}

/** A: the scorecard's link preview, every party's rating on every criterion, readable at a thumbnail's size. */
export interface OverviewCard extends DataFrame {
  /** The scorecard's question, which follows the methodology's kind. */
  title: string;
  /** "Elecciones de ejemplo · 6 criterios, con sus fuentes". */
  subtitle: string;
  parties: CardParty[];
  /** Each party's logo, by content hash, in the parties' order, when it has one a card can draw. */
  partyLogos?: ({ sha256: string; contentType: string } | null)[];
  /** The criteria's short titles, in their order. */
  criteria: string[];
  /** Each party's ratings, one per criterion, in the same orders. */
  cells: RatingDisplay[][];
  legend: LegendEntry[];
  /** What stands for parties that don't fit, `#` for how many: "y # más en la web". */
  more: string;
}

/** B: the whole table, to download and post (PLAN R162): every party, each rating's words under its icon. */
export interface TableCard extends DataFrame {
  title: string;
  /** "Elecciones de ejemplo · cada valoración, con sus citas en la web". */
  subtitle: string;
  parties: CardParty[];
  partyLogos?: ({ sha256: string; contentType: string } | null)[];
  criteria: string[];
  cells: CardRating[][];
  legend: LegendEntry[];
}

/** A rating in a list: what it rates, and the rating as an icon and words. */
export interface DataRow {
  label: string;
  rating: RatingDisplay;
  ratingLabel: string;
}

/** C: a party, each criterion's rating as a large icon and its words. */
export interface PartyCard extends DataFrame {
  /** Above the party's name: "¿Cumple las demandas de …?". */
  question: string;
  party: CardParty;
  /** The party's logo, by content hash, when it has one a card can draw. */
  partyLogo?: { sha256: string; contentType: string };
  /** Each criterion, by its title, with the party's rating. */
  rows: DataRow[];
  more: string;
}

/** D: a criterion, each party's rating on it. */
export interface CriterionCard extends DataFrame {
  /** "Criterio 3 de 6". */
  kicker: string;
  title: string;
  /** The criterion's description, cut to a few lines. */
  description?: string;
  /** Each party, in the site's order, with its rating. */
  rows: (DataRow & { party: CardParty })[];
  /** Each row's party's logo, by content hash, in the rows' order. */
  partyLogos?: ({ sha256: string; contentType: string } | null)[];
  more: string;
}

interface DataLayout {
  pad: number;
  /** Stories keep their top and bottom clear for the apps' own controls. */
  padTop: number;
  padBottom: number;
  site: number;
  title: number;
  subtitle: number;
  /** The body's base text: a party's short name, a criterion's title. */
  body: number;
  address: number;
  small: number;
  /** Landscape: the footer's lines side by side, the operator beside the site's name. */
  wide: boolean;
}

const LAYOUTS: Record<ShareSize, DataLayout> = {
  '1200x630': {
    pad: 44,
    padTop: 24,
    padBottom: 20,
    site: 19,
    title: 46,
    subtitle: 19,
    body: 24,
    address: 28,
    small: 15,
    wide: true,
  },
  '1080x1080': {
    pad: 56,
    padTop: 44,
    padBottom: 40,
    site: 25,
    title: 62,
    subtitle: 25,
    body: 30,
    address: 38,
    small: 19,
    wide: false,
  },
  '1080x1350': {
    pad: 56,
    padTop: 52,
    padBottom: 44,
    site: 27,
    title: 70,
    subtitle: 26,
    body: 32,
    address: 40,
    small: 20,
    wide: false,
  },
  '1080x1920': {
    pad: 72,
    padTop: 200,
    padBottom: 236,
    site: 30,
    title: 84,
    subtitle: 30,
    body: 36,
    address: 48,
    small: 23,
    wide: false,
  },
};

/** The site's name with its pause sign: the product people share (BRIEF §3, invariant 4). */
const siteLine = (site: string, size: number, theme: CardTheme): OgNode =>
  h(
    'div',
    {
      ...display,
      display: 'flex',
      alignItems: 'center',
      gap: size * 0.3,
      fontSize: size,
      lineHeight: 1.1,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      minWidth: 0,
      flexShrink: 1,
    },
    h(
      'div',
      { display: 'flex', gap: size * 0.14, flexShrink: 0 },
      h('div', { width: size * 0.2, height: size * 0.7, backgroundColor: theme.onAccent }),
      h('div', { width: size * 0.2, height: size * 0.7, backgroundColor: theme.onAccent }),
    ),
    oneLine({ minWidth: 0 }, site),
  );

/** A title as big as fits in two lines of `width`, up to `max`, and how many lines it takes. */
const fitTitle = (text: string, max: number, width: number) => {
  const perLine = (font: number) => Math.max(1, Math.floor(width / (font * DISPLAY_EM)));
  let font = max;
  while (font > max * 0.5 && text.length > perLine(font) * 2) {
    font = Math.floor(font * 0.92);
  }
  return { font, lines: text.length > perLine(font) ? 2 : 1 };
};

interface Head {
  title: string;
  /** Above the title, small: "Criterio 3 de 6", or a party's question. */
  kicker?: string;
  /** Below the title. */
  subtitle?: string;
  /** Beside the title, before it: a party's mark. */
  mark?: (size: number) => OgNode;
}

/**
 * The data cards' frame: the header on the accent (the site's name, the title and its lines, the operator), the body
 * on the canvas, and the footer under an ink rule (the data's date and the methodology small, the address large).
 * `content` gets the body's inner size, so lists and grids count what fits. `side`: the header and footer as a column
 * on the left, the body on the right (the criterion's link preview, canvas D).
 */
const dataFrame = (
  card: DataFrame,
  size: ShareSize,
  images: ElectionCardImages,
  head: Head,
  content: (inner: { width: number; height: number; l: DataLayout }) => OgChild[],
  { side = false }: { side?: boolean } = {},
): OgNode => {
  const { width, height } = SHARE_SIZES[size];
  const l = LAYOUTS[size];
  const { theme } = card;
  const operatorHeight = card.operatorLogo && images.operatorLogo ? l.small * 2.3 : l.small * 1.4;
  const headWidth = side ? Math.round(width * 0.36) : width;
  const titleWidth = headWidth - 2 * l.pad - (head.mark ? l.title * 1.4 : 0);
  const title = fitTitle(head.title, side ? l.title * 1.2 : l.title, titleWidth);
  const markSize = Math.round(Math.min(title.font * 1.25, l.title * 1.15));
  const kickerHeight = head.kicker ? l.subtitle * 1.5 : 0;
  const subtitleLines = side ? 4 : 1;
  const subtitleHeight = head.subtitle ? l.subtitle * 1.35 * subtitleLines + l.subtitle * 0.3 : 0;
  // On a landscape card the operator shares the site's line; elsewhere it closes the header.
  const operatorInHeader = !l.wide || side;
  const titleHeight = Math.max(
    title.font * (title.lines * 1.02 + 0.12),
    head.mark ? markSize + 8 : 0,
  );
  const gap = Math.round(l.small * 0.7);
  const footerSmall = l.small * 1.45;
  const footerHeight = side
    ? l.address * 1.3 + footerSmall * 3 + gap * 2
    : l.wide
      ? Math.max(l.address * 1.3, footerSmall * 2) + l.small * 0.9 + 3
      : l.address * 1.3 + footerSmall * 2 + l.small * 0.9 + 3;
  const headerContent =
    l.site * 1.2 +
    gap +
    kickerHeight +
    titleHeight +
    subtitleHeight +
    (operatorInHeader && !side ? gap + operatorHeight : 0);
  const headerHeight = side ? height : Math.round(l.padTop + headerContent + l.pad * 0.5);
  const bodyTop = side ? l.padTop + 8 : Math.round(l.pad * 0.45);
  const bodyBottom = Math.round(l.small * 0.8);
  const bodyHeight = side
    ? height - bodyTop - l.padBottom
    : height - headerHeight - footerHeight - l.padBottom - bodyTop - bodyBottom;
  const bodyWidth = side ? width - headWidth - 2 * l.pad : width - 2 * l.pad;

  const footer = h(
    'div',
    {
      display: 'flex',
      flexDirection: side ? 'column' : l.wide ? 'row' : 'column-reverse',
      justifyContent: 'space-between',
      alignItems: side || !l.wide ? 'flex-start' : 'flex-end',
      gap: side ? gap : l.wide ? 24 : 4,
      flexShrink: 0,
      ...(side
        ? {}
        : {
            height: footerHeight,
            margin: `0 ${l.pad}px`,
            paddingTop: l.small * 0.9,
            borderTop: `3px solid ${theme.ink}`,
          }),
      color: side ? theme.onAccent : theme.ink,
    },
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 1, minWidth: 0 },
      oneLine({ fontSize: l.small * 1.1, fontWeight: 700 }, card.dataDate),
      // Whole, on two lines in the narrow side panel: it is what the card's ratings are measured by.
      side
        ? clamped({ fontSize: l.small, lineHeight: 1.35 }, card.methodology, 2)
        : oneLine({ fontSize: l.small }, card.methodology),
    ),
    oneLine(
      { ...display, fontSize: l.address, lineHeight: 1.2, flexShrink: side ? 0 : 1 },
      card.address,
    ),
  );

  const header = h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: side ? 'space-between' : 'flex-start',
      width: headWidth,
      height: headerHeight,
      flexShrink: 0,
      padding: side
        ? `${l.padTop}px ${l.pad}px ${l.padBottom}px`
        : `${l.padTop}px ${l.pad}px ${Math.round(l.pad * 0.5)}px`,
      backgroundColor: theme.accent,
      color: theme.onAccent,
      overflow: 'hidden',
    },
    h(
      'div',
      { display: 'flex', flexDirection: 'column', gap },
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        },
        siteLine(card.site, l.site, theme),
        ...(operatorInHeader ? [] : [operatorLine(card, images, l.small)]),
      ),
      ...(head.kicker
        ? [oneLine({ fontSize: l.subtitle, lineHeight: 1.3, fontWeight: 700 }, head.kicker)]
        : []),
      h(
        'div',
        { display: 'flex', alignItems: 'center', gap: Math.round(title.font * 0.3) },
        ...(head.mark ? [head.mark(markSize)] : []),
        clamped(
          { ...display, fontSize: title.font, lineHeight: 1.02, flexShrink: 1, minWidth: 0 },
          head.title,
          2,
        ),
      ),
      ...(head.subtitle
        ? [clamped({ fontSize: l.subtitle, lineHeight: 1.35 }, head.subtitle, subtitleLines)]
        : []),
      ...(operatorInHeader && !side ? [operatorLine(card, images, l.small)] : []),
    ),
    ...(side
      ? [
          h(
            'div',
            { display: 'flex', flexDirection: 'column', gap },
            operatorLine(card, images, l.small),
            footer,
          ),
        ]
      : []),
  );

  const body = h(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: bodyWidth + 2 * l.pad,
      height: bodyHeight + bodyTop + bodyBottom,
      padding: `${bodyTop}px ${l.pad}px ${bodyBottom}px`,
      flexShrink: 0,
      overflow: 'hidden',
    },
    ...content({ width: bodyWidth, height: bodyHeight, l }),
  );

  return h(
    'div',
    {
      display: 'flex',
      flexDirection: side ? 'row' : 'column',
      width,
      height,
      ...(side ? {} : { paddingBottom: l.padBottom }),
      backgroundColor: theme.canvas,
      color: theme.ink,
      fontFamily: 'Roboto Slab',
    },
    header,
    body,
    ...(side ? [] : [footer]),
  );
};

/** A party's short name in the display face, its full name under it when there is room, the colour line under both. */
const partyNames = (party: CardParty, font: number, withFull: boolean, theme: CardTheme): OgNode =>
  nameWithLine(
    h(
      'div',
      { display: 'flex', flexDirection: 'column', minWidth: 0 },
      oneLine({ ...display, fontSize: font, lineHeight: 1.0, color: theme.ink }, party.short),
      ...(withFull && party.name !== party.short
        ? [oneLine({ fontSize: font * 0.52, lineHeight: 1.25, color: theme.muted }, party.name)]
        : []),
    ),
    party.colour,
    font * 0.9,
  );

/**
 * Parties down the side and criteria across (A and B): each party's mark and names, then a rating's icon per
 * criterion, and with `words`, its words under it where they fit. The criteria's short titles head their columns, or
 * their numbers where columns are narrow, the numbers then keyed below the table. Rows grow into the room, within
 * limits; past the smallest, with `more`, the parties that fit and "and # more".
 */
const ratingGrid = (
  parties: CardParty[],
  logos: (ElectionCardImages['partyLogo'] | undefined)[],
  criteria: string[],
  cells: { rating: RatingDisplay; label?: string }[][],
  space: { width: number; height: number },
  l: DataLayout,
  theme: CardTheme,
  { words, more, legendEntries }: { words: boolean; more?: string; legendEntries: LegendEntry[] },
): OgChild[] => {
  const marked = logos.some(Boolean) || parties.some((party) => party.colour);
  const columns = Math.max(1, criteria.length);
  const longest = Math.max(1, ...parties.map((party) => party.short.length));
  const nameFont = l.body;
  const markBox = Math.round(nameFont * 1.5);
  const partyWidth = Math.round(
    Math.min(
      space.width * 0.38,
      Math.max(
        space.width * 0.2,
        longest * nameFont * DISPLAY_EM * 1.05 + (marked ? markBox + 14 : 0) + 12,
      ),
    ),
  );
  const columnWidth = (space.width - partyWidth) / columns;
  const headFont = Math.round(Math.min(l.small * 1.15, columnWidth * 0.2 + 6));
  const across = columnWidth >= headFont * 4.2;
  const headHeight = Math.round(across ? headFont * 1.2 * 2 + headFont * 0.6 : headFont * 1.6);
  const legendFont = Math.round(l.small * 1.05);
  const legendHeight = Math.round(legendFont * 1.4 * (l.wide ? 1 : 2) + legendFont * 0.8);
  const keyHeight = across ? 0 : Math.round(l.small * 1.45 * 3 + l.small * 0.5);
  const rule = 1;
  const available = space.height - headHeight - legendHeight - keyHeight;
  const maxRow = nameFont * (words ? 3.6 : 2.7);
  const minRow = nameFont * (more ? 1.5 : 1.05);
  let shown = parties.length;
  let rowHeight = Math.min(maxRow, available / Math.max(1, shown) - rule);
  if (more && rowHeight < minRow) {
    // The parties that fit above the "and # more" line.
    shown = Math.max(1, Math.floor((available - l.small * 1.9) / (minRow + rule)));
    rowHeight = minRow;
  }
  rowHeight = Math.max(8, Math.floor(rowHeight));
  const hidden = parties.length - shown;
  const icon = Math.round(
    Math.max(8, Math.min(rowHeight * (words ? 0.55 : 0.74), columnWidth * 0.72, nameFont * 2.3)),
  );
  const wordFont = Math.round(Math.min(l.small, columnWidth / 6.5));
  // Two lines for the longer words ("Cumple parcialmente"), where the row has room for them.
  const wordLines = rowHeight >= icon + wordFont * 2.6 ? 2 : 1;
  const showWords = words && rowHeight >= icon + wordFont * 1.5 && wordFont >= 11;
  const showFull = rowHeight >= nameFont * 1.85;
  const font = Math.round(Math.min(nameFont, rowHeight * 0.55));

  const headRow = h(
    'div',
    {
      display: 'flex',
      alignItems: 'flex-end',
      height: headHeight,
      flexShrink: 0,
      paddingBottom: headFont * 0.35,
      borderBottom: `3px solid ${theme.ink}`,
    },
    h('div', { display: 'flex', width: partyWidth, flexShrink: 0 }),
    ...criteria.map((criterion, index) =>
      h(
        'div',
        {
          display: 'flex',
          justifyContent: 'center',
          width: columnWidth,
          flexShrink: 0,
          padding: `0 ${Math.round(headFont * 0.2)}px`,
        },
        across
          ? clamped(
              {
                ...display,
                fontWeight: 600,
                fontSize: headFont,
                lineHeight: 1.15,
                textAlign: 'center',
                color: theme.muted,
              },
              criterion,
              2,
            )
          : oneLine({ ...display, fontSize: headFont * 1.2, color: theme.ink }, String(index + 1)),
      ),
    ),
  );

  const row = (
    party: CardParty,
    ratings: { rating: RatingDisplay; label?: string }[],
    index: number,
  ) =>
    h(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        height: rowHeight + rule,
        flexShrink: 0,
        borderBottom: `${rule}px solid ${theme.rule}`,
      },
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          gap: Math.round(font * 0.45),
          width: partyWidth,
          flexShrink: 0,
          paddingRight: Math.round(font * 0.4),
        },
        ...(marked
          ? [partyMark(logos[index], party.colour, Math.min(markBox, rowHeight * 0.85), theme)]
          : []),
        partyNames(party, font, showFull, theme),
      ),
      ...ratings.map((cell) =>
        h(
          'div',
          {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Math.round(wordFont * 0.25),
            width: columnWidth,
            flexShrink: 0,
          },
          ratingIcon(cell.rating, icon),
          ...(showWords && cell.label
            ? [
                clamped(
                  {
                    fontSize: wordFont,
                    lineHeight: 1.1,
                    color: theme.ink,
                    textAlign: 'center',
                    maxWidth: columnWidth - 6,
                  },
                  cell.label,
                  wordLines,
                ),
              ]
            : []),
        ),
      ),
    );

  return [
    headRow,
    ...parties.slice(0, shown).map((party, index) => row(party, cells[index] ?? [], index)),
    ...(hidden > 0 && more
      ? [
          oneLine(
            { fontSize: l.small * 1.1, color: theme.muted, marginTop: l.small * 0.4 },
            more.replace('#', String(hidden)),
          ),
        ]
      : []),
    ...(across
      ? []
      : [
          clamped(
            { fontSize: l.small, lineHeight: 1.45, color: theme.muted, marginTop: l.small * 0.5 },
            criteria.map((criterion, index) => `${index + 1}. ${criterion}`).join(' · '),
            3,
          ),
        ]),
    h(
      'div',
      { display: 'flex', paddingTop: legendFont * 0.8, flexShrink: 0 },
      legend(legendEntries, legendFont, theme),
    ),
  ];
};

/** A: every party's rating on every criterion, as the scorecard's link preview. */
export const overviewCard = (
  card: OverviewCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  dataFrame(card, size, images, { title: card.title, subtitle: card.subtitle }, (space) =>
    ratingGrid(
      card.parties,
      card.parties.map((_, index) =>
        card.partyLogos?.[index] ? images.partyLogos?.[index] : undefined,
      ),
      card.criteria,
      card.cells.map((row) => row.map((rating) => ({ rating }))),
      space,
      space.l,
      card.theme,
      { words: false, more: card.more, legendEntries: card.legend },
    ),
  );

/** B: the whole table, every party, each rating's words under its icon where they fit. */
export const tableCard = (
  card: TableCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  dataFrame(card, size, images, { title: card.title, subtitle: card.subtitle }, (space) =>
    ratingGrid(
      card.parties,
      card.parties.map((_, index) =>
        card.partyLogos?.[index] ? images.partyLogos?.[index] : undefined,
      ),
      card.criteria,
      card.cells,
      space,
      space.l,
      card.theme,
      { words: true, legendEntries: card.legend },
    ),
  );

/**
 * Rows of a large rating's icon beside what it rates and its words (C and D), as many as fit, in columns on a
 * landscape card, the last place "and # more" when some don't. `lead` draws what a row starts with after the icon.
 */
const dataRows = <Row extends DataRow>(
  rows: Row[],
  more: string,
  space: { width: number; height: number },
  l: DataLayout,
  theme: CardTheme,
  lead: (row: Row, index: number, font: number) => OgNode,
  { iconFirst }: { iconFirst: boolean },
): OgChild[] => {
  const font = l.body;
  const columns = l.wide && rows.length > 6 ? 2 : 1;
  const gap = Math.round(font * 1.2);
  const columnWidth = (space.width - gap * (columns - 1)) / columns;
  const maxRow = font * 3.2;
  const minRow = font * 1.9;
  const perColumn = Math.max(1, Math.floor(space.height / minRow));
  const capacity = perColumn * columns;
  const shown = rows.length > capacity ? rows.slice(0, capacity - 1) : rows;
  const hidden = rows.length - shown.length;
  const inColumn = Math.ceil((shown.length + (hidden > 0 ? 1 : 0)) / columns);
  const rowHeight = Math.floor(Math.min(maxRow, space.height / Math.max(1, inColumn)));
  const icon = Math.round(Math.min(rowHeight * 0.74, font * 2.4));
  const labelFont = Math.round(Math.min(font * 0.8, rowHeight * 0.3));
  const item = (row: Row, index: number): OgNode =>
    h(
      'div',
      {
        display: 'flex',
        alignItems: 'center',
        gap: Math.round(font * 0.6),
        height: rowHeight,
        width: columnWidth,
        flexShrink: 0,
        borderBottom: `1px solid ${theme.rule}`,
      },
      ...(iconFirst ? [ratingIcon(row.rating, icon)] : []),
      h(
        'div',
        {
          display: 'flex',
          flexDirection: iconFirst ? 'column' : 'row',
          alignItems: iconFirst ? 'flex-start' : 'center',
          justifyContent: iconFirst ? 'center' : 'space-between',
          gap: iconFirst ? Math.round(labelFont * 0.2) : Math.round(font * 0.5),
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
        },
        lead(row, index, Math.round(Math.min(font * 1.05, rowHeight * 0.42))),
        iconFirst
          ? oneLine({ fontSize: labelFont, fontWeight: 700, lineHeight: 1.2 }, row.ratingLabel)
          : ratingWords(
              row.rating,
              row.ratingLabel,
              Math.round(Math.min(font * 0.9, rowHeight * 0.36)),
              theme,
            ),
      ),
    );
  const items: OgNode[] = shown.map(item);
  if (hidden > 0) {
    items.push(
      h(
        'div',
        { display: 'flex', alignItems: 'center', height: rowHeight, width: columnWidth },
        oneLine({ fontSize: l.small * 1.1, color: theme.muted }, more.replace('#', String(hidden))),
      ),
    );
  }
  return [
    h(
      'div',
      { display: 'flex', gap, flexGrow: 1 },
      ...Array.from({ length: columns }, (_, c) =>
        h(
          'div',
          { display: 'flex', flexDirection: 'column', width: columnWidth },
          ...items.slice(c * inColumn, (c + 1) * inColumn),
        ),
      ),
    ),
  ];
};

/** C: a party, its mark beside its name, each criterion's rating as a large icon and its words. */
export const partyCard = (
  card: PartyCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode =>
  dataFrame(
    card,
    size,
    images,
    {
      kicker: card.question,
      title: card.party.name,
      ...(card.partyLogo || card.party.colour
        ? {
            mark: (box: number) =>
              partyMark(
                card.partyLogo ? images.partyLogo : undefined,
                card.party.colour,
                box,
                card.theme,
              ),
          }
        : {}),
    },
    (space) =>
      dataRows(
        card.rows,
        card.more,
        space,
        space.l,
        card.theme,
        (row, _, font) =>
          oneLine(
            { ...display, fontSize: font, lineHeight: 1.05, color: card.theme.ink },
            row.label,
          ),
        { iconFirst: true },
      ),
  );

/** D: a criterion, each party's mark and names, its rating's icon and words. */
export const criterionCard = (
  card: CriterionCard,
  size: ShareSize,
  images: ElectionCardImages = {},
): OgNode => {
  const marked =
    Boolean(card.partyLogos?.some(Boolean)) || card.rows.some((row) => row.party.colour);
  return dataFrame(
    card,
    size,
    images,
    {
      kicker: card.kicker,
      title: card.title,
      ...(card.description ? { subtitle: card.description } : {}),
    },
    (space) =>
      dataRows(
        card.rows,
        card.more,
        space,
        space.l,
        card.theme,
        (row, index, font) =>
          h(
            'div',
            {
              display: 'flex',
              alignItems: 'center',
              gap: Math.round(font * 0.45),
              minWidth: 0,
              flexShrink: 1,
            },
            ...(marked
              ? [
                  partyMark(
                    card.partyLogos?.[index] ? images.partyLogos?.[index] : undefined,
                    row.party.colour,
                    Math.round(font * 1.4),
                    card.theme,
                  ),
                ]
              : []),
            partyNames(row.party, font, true, card.theme),
          ),
        { iconFirst: false },
      ),
    { side: size === '1200x630' },
  );
};
