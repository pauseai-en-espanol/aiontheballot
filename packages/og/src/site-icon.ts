import {
  ballotBox,
  ballotBoxPaint,
  MARK_GLYPHS,
  type MarkLetters,
  shapeSvg,
} from '@aiontheballot/ui/ballot-box';
import { palette } from '@aiontheballot/ui/brand';
import { createHash } from 'node:crypto';
import { crc32, inflateSync } from 'node:zlib';

import { imageSize } from './image-size.js';

/**
 * The site icon (favicon): the platform's default, or a tenant's own square PNG from its `site_icon` logo slot. Never
 * another organization's mark: when a tenant has no usable icon, it gets the default.
 */

/** Every size drawn: tabs (16, 32), the .ico's largest (48), Apple's home screen (180), the manifest's (192, 512). */
export const SITE_ICON_SIZES = [16, 32, 48, 180, 192, 512] as const;
export type SiteIconSize = (typeof SITE_ICON_SIZES)[number];

/** The sizes served on their own: 48 px is drawn only inside /favicon.ico. */
export const SERVED_SITE_ICON_SIZES = [
  16, 32, 180, 192, 512,
] as const satisfies readonly SiteIconSize[];
export type ServedSiteIconSize = (typeof SERVED_SITE_ICON_SIZES)[number];

export const isServedSiteIconSize = (value: number): value is ServedSiteIconSize =>
  (SERVED_SITE_ICON_SIZES as readonly number[]).includes(value);

/** The sizes inside /favicon.ico. */
export const ICO_SIZES = [16, 32, 48] as const satisfies readonly SiteIconSize[];

/**
 * A tenant's icon must be a square PNG at least this many pixels a side, so every size served is a reduction, and at
 * most 1,024: nothing larger than 512 is ever served, and every extra pixel costs the renderer (a tiny file can
 * declare a huge image).
 */
export const SITE_ICON_MIN_SIDE = 512;
export const SITE_ICON_MAX_SIDE = 1024;

/** Bump when the way icons are rendered changes (not the default's drawing, whose text the hash covers already). */
export const SITE_ICON_VERSION = 1;

/** The web manifest's colours: the platform's palette, like the default icon. */
export const SITE_ICON_COLOURS = { background: palette.paper, theme: palette.orange } as const;

/** The platform's default icon, marked with the letters for AI in the site's language (PLAN R238), or a tenant's own. */
export type SiteIconSource =
  { kind: 'default'; letters: MarkLetters } | { kind: 'tenant'; sha256: string };

export const defaultSiteIcon = (letters: MarkLetters): SiteIconSource => ({
  kind: 'default',
  letters,
});

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Channels per pixel, by PNG colour type: grey, RGB, palette, grey and alpha, RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** The bit depths the PNG specification allows for each colour type. Anything else draws nothing. */
const DEPTHS: Readonly<Record<number, readonly number[]>> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/** The chunks a decoder must understand. Any other critical chunk (an upper-case first letter) is unknown. */
const CRITICAL = ['IHDR', 'PLTE', 'IDAT', 'IEND'];

/** The seven passes of Adam7 interlacing: where each starts and how far it steps, across and down. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/** The rows of a PNG's image data, as [bytes per row including its filter byte, row count], pass by pass. */
const rowsOf = (
  width: number,
  height: number,
  bits: number,
  interlaced: boolean,
): (readonly [number, number])[] => {
  const rows = (w: number, h: number) =>
    w > 0 && h > 0 ? [[Math.ceil((w * bits) / 8) + 1, h] as const] : [];
  return interlaced
    ? ADAM7.flatMap(([x, y, dx, dy]) =>
        rows(Math.ceil((width - x) / dx), Math.ceil((height - y) / dy)),
      )
    : rows(width, height);
};

/**
 * Whether the bytes are a whole PNG that a decoder will draw: the signature; every chunk's checksum; IHDR first, with a
 * colour type and bit depth the format allows and its only compression and filter methods; a palette before the image
 * data when it needs one; image data in consecutive chunks that inflates to exactly what the header promises, every
 * row starting with a known filter; IEND last, with nothing after it; no critical chunk a decoder wouldn't know. A file
 * that fails any of these would otherwise pass a header check and then quietly draw nothing, and the allowed depths
 * bound what inflating can cost (at most about 8 MB at 1,024 px).
 */
export const isCompletePng = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 8 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  let offset = 8;
  let header: Uint8Array | undefined;
  let palette = false;
  let ended = false;
  let previous = '';
  const data: Uint8Array[] = [];
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) {
      return false;
    }
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)
    ) {
      return false;
    }
    const kind = type(offset + 4);
    const critical = /^[A-Z]/.test(kind);
    if ((offset === 8) !== (kind === 'IHDR') || (critical && !CRITICAL.includes(kind))) {
      return false;
    }
    if (kind === 'IHDR') {
      header = bytes.subarray(offset + 8, offset + 8 + length);
    } else if (kind === 'PLTE') {
      palette = data.length === 0;
    } else if (kind === 'IDAT') {
      // The image data comes in one run of chunks.
      if (data.length > 0 && previous !== 'IDAT') {
        return false;
      }
      data.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    previous = kind;
    offset = end;
    if (kind === 'IEND') {
      ended = true;
      break;
    }
  }
  // Nothing may follow IEND either.
  if (!ended || offset !== bytes.byteLength || header?.byteLength !== 13 || data.length === 0) {
    return false;
  }
  const head = new DataView(header.buffer, header.byteOffset, 13);
  const [width, height, depth, colour, compression, filter, interlace] = [
    head.getUint32(0),
    head.getUint32(4),
    head.getUint8(8),
    head.getUint8(9),
    head.getUint8(10),
    head.getUint8(11),
    head.getUint8(12),
  ];
  const channels = CHANNELS[colour];
  if (
    channels === undefined ||
    !DEPTHS[colour]?.includes(depth) ||
    compression !== 0 ||
    filter !== 0 ||
    interlace > 1 ||
    (colour === 3 && !palette) ||
    width > SITE_ICON_MAX_SIDE ||
    height > SITE_ICON_MAX_SIDE
  ) {
    return false;
  }
  const rows = rowsOf(width, height, channels * depth, interlace === 1);
  const expected = rows.reduce((sum, [bytesPerRow, count]) => sum + bytesPerRow * count, 0);
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch {
    return false;
  }
  if (pixels.byteLength !== expected) {
    return false;
  }
  // Every row starts with one of the five filters.
  let at = 0;
  for (const [bytesPerRow, count] of rows) {
    for (let row = 0; row < count; row += 1, at += bytesPerRow) {
      if ((pixels[at] ?? 5) > 4) {
        return false;
      }
    }
  }
  return true;
};

/** Whether a tenant's upload can be its icon: a whole PNG, square, of a usable size. */
export const isUsableSiteIcon = (bytes: Uint8Array): boolean => {
  const size = imageSize(bytes);
  return (
    size?.type === 'image/png' &&
    size.width === size.height &&
    size.width >= SITE_ICON_MIN_SIDE &&
    size.width <= SITE_ICON_MAX_SIDE &&
    isCompletePng(bytes)
  );
};

/**
 * The letters drawn pixel by pixel where curves and thin strokes would blur: 3 by 5 for 16 px, 5 by 7 for 32 px. Each
 * glyph is its rows, `#` a pixel; the letters stand one pixel apart.
 */
const PIXEL_GLYPHS: Record<16 | 32, Record<'I' | 'A', readonly string[]>> = {
  16: {
    I: ['#', '#', '#', '#', '#'],
    A: ['.#.', '#.#', '###', '#.#', '#.#'],
  },
  32: {
    I: ['##', '##', '##', '##', '##', '##', '##'],
    A: ['.###.', '##.##', '##.##', '#####', '##.##', '##.##', '##.##'],
  },
};

/** The letters' pixels as rects, their top-left pixel at (x, y). */
const pixelLetters = (letters: MarkLetters, grid: 16 | 32, x: number, y: number): string[] => {
  const rects: string[] = [];
  let left = x;
  for (const letter of MARK_GLYPHS[letters]) {
    const rows = PIXEL_GLYPHS[grid][letter];
    rows.forEach((row, dy) => {
      Array.from({ length: row.length }, (_, dx) => row.charAt(dx)).forEach((cell, dx) => {
        if (cell === '#') {
          rects.push(`<rect x="${left + dx}" y="${y + dy}" width="1" height="1" fill="${ink}"/>`);
        }
      });
    });
    left += (rows[0]?.length ?? 0) + 1;
  }
  return rects;
};

/** The letters' width in pixels, gap included. */
const pixelWidth = (letters: MarkLetters, grid: 16 | 32): number =>
  MARK_GLYPHS[letters].reduce(
    (width, letter) => width + (PIXEL_GLYPHS[grid][letter][0]?.length ?? 0) + 1,
    -1,
  );

const { orange, ink, paper } = palette;

const svg = (viewBox: number, ...parts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}">${parts.join('')}</svg>`;

/**
 * The platform's default icon: the site's mark (PLAN R238), a ballot marked with the letters for AI in the site's
 * language going into a transparent ballot box, on an orange tile, so its marks keep their contrast whatever the tab's
 * colour. No tenant's branding. 16 and 32 px have their own drawings, fitted to the pixel grid; from 180 px the tile
 * fills the square, since home screens cut their own corners (and fill transparency with black).
 */
export const defaultSiteIconSvg = (size: SiteIconSize, letters: MarkLetters): string => {
  if (size === 16 || size === 32) {
    const grid = size;
    const at = (small: number, large: number) => (grid === 16 ? small : large);
    const ballot = { x: at(4, 9), y: at(1, 2), width: at(8, 14), height: at(8, 15) };
    const lettersTop = at(2, 4);
    const lettersLeft = ballot.x + Math.floor((ballot.width - pixelWidth(letters, grid)) / 2);
    return svg(
      grid,
      `<rect width="${grid}" height="${grid}" rx="${at(3, 6)}" fill="${orange}"/>`,
      `<rect x="${ballot.x}" y="${ballot.y}" width="${ballot.width}" height="${ballot.height}" fill="${paper}"/>`,
      ...pixelLetters(letters, grid, lettersLeft, lettersTop),
      // The box's outline, then its slot over the ballot.
      grid === 16
        ? `<rect x="1.5" y="9.5" width="13" height="5" fill="none" stroke="${ink}" stroke-width="1"/>`
        : `<rect x="3" y="17" width="26" height="13" rx="2.5" fill="none" stroke="${ink}" stroke-width="2"/>`,
      grid === 16
        ? `<rect x="3" y="8" width="10" height="2" fill="${ink}"/>`
        : `<rect x="6" y="15" width="20" height="4" rx="2" fill="${ink}"/>`,
    );
  }
  const mark = ballotBox('compact', letters);
  const paint = ballotBoxPaint({ canvas: paper, ink, onAccent: ink });
  return svg(
    64,
    `<rect width="64" height="64"${size < 180 ? ' rx="14"' : ''} fill="${orange}"/>`,
    `<g transform="translate(0 ${(64 - mark.height) / 2})">`,
    ...mark.shapes.map((shape) => shapeSvg(shape, paint)),
    '</g>',
  );
};

/**
 * The content hash in an icon's URL. It covers what the picture is drawn from (the default's drawing itself, or the
 * tenant's bytes by their hash), the size, and for the .ico the sizes inside it, so a cached URL never shows another
 * picture.
 */
export const siteIconHash = (source: SiteIconSource, size: SiteIconSize | 'ico'): string => {
  const sizes = size === 'ico' ? ICO_SIZES : [size];
  const drawings =
    source.kind === 'default' ? sizes.map((each) => defaultSiteIconSvg(each, source.letters)) : [];
  return createHash('sha256')
    .update(JSON.stringify([SITE_ICON_VERSION, source, size, sizes, drawings]))
    .digest('hex')
    .slice(0, 12);
};

/** A tenant's PNG drawn at `side` pixels, over a solid `background` if given: the renderer scales it. */
export const tenantSiteIconSvg = (png: Uint8Array, side: number, background?: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">` +
  (background ? `<rect width="${side}" height="${side}" fill="${background}"/>` : '') +
  `<image width="${side}" height="${side}" href="data:image/png;base64,${Buffer.from(png).toString('base64')}"/>` +
  '</svg>';

/**
 * An .ico file holding PNG images (every browser since 2007 reads them): a 6-byte header, a 16-byte entry per image,
 * then the images.
 */
export const encodeIco = (images: readonly { size: number; png: Uint8Array }[]): Uint8Array => {
  const header = 6 + 16 * images.length;
  const total = header + images.reduce((sum, image) => sum + image.png.byteLength, 0);
  const ico = new Uint8Array(total);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    view.setUint8(entry, size >= 256 ? 0 : size); // 0 means 256
    view.setUint8(entry + 1, size >= 256 ? 0 : size);
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, png.byteLength, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(png, offset);
    offset += png.byteLength;
  });
  return ico;
};
