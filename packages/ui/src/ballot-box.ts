/**
 * The site's mark (PLAN R238): a ballot marked with the letters for AI going into the slot of a transparent ballot box,
 * "AI on the ballot". One drawing for every place it appears (the header, the coming-soon page, the share images and
 * the site icon), as shapes each renderer paints with its own colours: Panda's roles on the pages, a card's theme in the
 * share images, the palette in the icon. The letters are shapes too, so nothing needs a font to draw them.
 */

/** The letters the ballot is marked with, in the site's language: what "AI" is called there. */
export type MarkLetters = 'IA' | 'AI';

/** Each set's glyphs, in order. */
export const MARK_GLYPHS: Record<MarkLetters, readonly ('I' | 'A')[]> = {
  IA: ['I', 'A'],
  AI: ['A', 'I'],
};

/** The letters for a language: «IA» in the Romance languages the platform speaks, «AI» in English. */
export const markLetters = (locale: string): MarkLetters =>
  locale.toLowerCase().startsWith('en') ? 'AI' : 'IA';

/**
 * What each shape is, so a renderer knows its colour: the ballot's paper; what is printed on it (the letters, the
 * boxes), full or faded (the options not chosen); and the ballot box on the accent, its outline and slot, and the
 * glint of its glass.
 */
export type BallotBoxRole = 'paper' | 'mark' | 'faded' | 'box' | 'glass';

export type BallotBoxShape =
  | {
      kind: 'rect';
      role: BallotBoxRole;
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
      /** An outline this wide, centred on the edge, instead of a fill. */
      stroke?: number;
    }
  | { kind: 'path'; role: BallotBoxRole; d: string };

export interface BallotBoxDrawing {
  width: number;
  height: number;
  shapes: readonly BallotBoxShape[];
}

type Point = readonly [number, number];

/** The letters' shapes, 100 units tall: a condensed bold, after the site's display face (Saira Condensed). */
const GLYPHS: Record<'I' | 'A', { width: number; outlines: readonly (readonly Point[])[] }> = {
  I: {
    width: 20,
    outlines: [
      [
        [0, 0],
        [20, 0],
        [20, 100],
        [0, 100],
      ],
    ],
  },
  A: {
    width: 58,
    outlines: [
      [
        [0, 100],
        [17, 0],
        [41, 0],
        [58, 100],
        [42, 100],
        [38.5, 80],
        [19.5, 80],
        [16, 100],
      ],
      // The counter above the crossbar: a hole, drawn even-odd.
      [
        [26.5, 22],
        [31.5, 22],
        [37.4, 64],
        [20.6, 64],
      ],
    ],
  },
};
const GAP = 7;

const round = (value: number) => Math.round(value * 100) / 100;

/** The letters' width at a cap height. */
export const lettersWidth = (height: number): number =>
  ((GLYPHS.I.width + GAP + GLYPHS.A.width) * height) / 100;

/** The letters as one path (even-odd), their top-left corner at (x, y), `height` units tall. */
export const lettersPath = (letters: MarkLetters, x: number, y: number, height: number): string => {
  const scale = height / 100;
  let left = x;
  const parts: string[] = [];
  for (const letter of MARK_GLYPHS[letters]) {
    const glyph = GLYPHS[letter];
    for (const outline of glyph.outlines) {
      parts.push(
        `M${outline
          .map(([px, py]) => `${round(left + px * scale)} ${round(y + py * scale)}`)
          .join('L')}Z`,
      );
    }
    left += (glyph.width + GAP) * scale;
  }
  return parts.join('');
};

/**
 * The mark large, for the coming-soon page and its share image: a ballot of two options, the first ticked and marked
 * with the letters, half into the slot of a transparent box, where it shows through the glass.
 */
const hero = (letters: MarkLetters): BallotBoxDrawing => ({
  width: 440,
  height: 220,
  shapes: [
    { kind: 'rect', role: 'paper', x: 150, y: 0, width: 140, height: 152 },
    { kind: 'rect', role: 'mark', x: 168.5, y: 23.5, width: 17, height: 17, stroke: 3 },
    { kind: 'rect', role: 'mark', x: 173, y: 28, width: 8, height: 8 },
    { kind: 'path', role: 'mark', d: lettersPath(letters, 199, 18, 28) },
    { kind: 'rect', role: 'mark', x: 168.5, y: 63.5, width: 17, height: 17, stroke: 3 },
    { kind: 'rect', role: 'faded', x: 199, y: 69, width: 72, height: 6 },
    { kind: 'rect', role: 'box', x: 54, y: 114, width: 332, height: 102, rx: 10, stroke: 8 },
    { kind: 'rect', role: 'glass', x: 80, y: 138, width: 64, height: 8, rx: 4 },
    { kind: 'rect', role: 'glass', x: 80, y: 154, width: 30, height: 8, rx: 4 },
    { kind: 'rect', role: 'box', x: 120, y: 106, width: 200, height: 16, rx: 8 },
  ],
});

/** The mark small, beside the site's name: the ballot marked with the letters, going into the box. */
const compact = (letters: MarkLetters): BallotBoxDrawing => {
  const height = 13;
  return {
    width: 64,
    height: 56,
    shapes: [
      { kind: 'rect', role: 'paper', x: 18, y: 0, width: 28, height: 28 },
      {
        kind: 'path',
        role: 'mark',
        d: lettersPath(letters, round(32 - lettersWidth(height) / 2), 6, height),
      },
      { kind: 'rect', role: 'box', x: 8, y: 26, width: 48, height: 28, rx: 4, stroke: 4 },
      { kind: 'rect', role: 'box', x: 14, y: 22, width: 36, height: 7, rx: 3.5 },
    ],
  };
};

export const ballotBox = (variant: 'hero' | 'compact', letters: MarkLetters): BallotBoxDrawing =>
  variant === 'hero' ? hero(letters) : compact(letters);

/** How a renderer paints each role: a colour, and an opacity for the faded ones. */
export type BallotBoxPaint = Record<BallotBoxRole, { colour: string; opacity?: number }>;

/** The colours on the accent: the ballot on the canvas colour, printed in ink, the box in the colour on the accent. */
export const ballotBoxPaint = (colours: {
  canvas: string;
  ink: string;
  onAccent: string;
}): BallotBoxPaint => ({
  paper: { colour: colours.canvas },
  mark: { colour: colours.ink },
  faded: { colour: colours.ink, opacity: 0.35 },
  box: { colour: colours.onAccent },
  glass: { colour: colours.onAccent, opacity: 0.25 },
});

/** One shape as SVG markup, painted. */
export const shapeSvg = (shape: BallotBoxShape, paint: BallotBoxPaint): string => {
  const { colour, opacity } = paint[shape.role];
  const alpha = opacity === undefined ? '' : ` opacity="${opacity}"`;
  if (shape.kind === 'path') {
    return `<path d="${shape.d}" fill="${colour}" fill-rule="evenodd"${alpha}/>`;
  }
  const corner = shape.rx === undefined ? '' : ` rx="${shape.rx}"`;
  const box = `x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${corner}`;
  return shape.stroke === undefined
    ? `<rect ${box} fill="${colour}"${alpha}/>`
    : `<rect ${box} fill="none" stroke="${colour}" stroke-width="${shape.stroke}"${alpha}/>`;
};

/** The drawing as a standalone SVG document, for share images and anything else drawn outside the page. */
export const ballotBoxSvg = (drawing: BallotBoxDrawing, paint: BallotBoxPaint): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" ` +
  `viewBox="0 0 ${drawing.width} ${drawing.height}">` +
  drawing.shapes.map((shape) => shapeSvg(shape, paint)).join('') +
  '</svg>';
