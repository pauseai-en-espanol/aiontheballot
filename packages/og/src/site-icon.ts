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

export type SiteIconSource = { kind: 'default' } | { kind: 'tenant'; sha256: string };

export const DEFAULT_SITE_ICON: SiteIconSource = { kind: 'default' };

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

/** A four-pointed sparkle, the usual sign for AI, centred at (cx, cy) with arms of length r and a waist of w. */
const sparkle = (cx: number, cy: number, r: number, w: number): string => {
  const c = w * 0.3;
  return [
    `M${cx} ${cy - r}`,
    `C${cx + c} ${cy - w} ${cx + w} ${cy - c} ${cx + r} ${cy}`,
    `C${cx + w} ${cy + c} ${cx + c} ${cy + w} ${cx} ${cy + r}`,
    `C${cx - c} ${cy + w} ${cx - w} ${cy + c} ${cx - r} ${cy}`,
    `C${cx - w} ${cy - c} ${cx - c} ${cy - w} ${cx} ${cy - r}Z`,
  ].join(' ');
};

/** The sparkle drawn pixel by pixel for 16 px, where a curve blurs into a blot: rows of [from, to) columns. */
const PIXEL_SPARKLE = [
  [3, 4],
  [3, 4],
  [2, 5],
  [0, 7],
  [2, 5],
  [3, 4],
  [3, 4],
] as const;

const { orange, ink, paper } = palette;

const svg = (viewBox: number, ...parts: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}">${parts.join('')}</svg>`;

/**
 * The platform's default icon: the coming-soon page's ballot going into the slot of a ballot box, marked with the AI
 * sparkle instead of a cross ("AI on the ballot"), on an orange tile, so its marks keep their contrast whatever the
 * tab's colour. No text and no tenant's branding. 16 and 32 px have their own drawings, fitted to the pixel grid;
 * from 180 px the tile fills the square, since home screens cut their own corners (and fill transparency with black).
 */
export const defaultSiteIconSvg = (size: SiteIconSize): string => {
  if (size === 16) {
    return svg(
      16,
      `<rect width="16" height="16" rx="3" fill="${orange}"/>`,
      `<rect x="3" y="1" width="9" height="11" fill="${paper}"/>`,
      ...PIXEL_SPARKLE.map(
        ([from, to], row) =>
          `<rect x="${4 + from}" y="${3 + row}" width="${to - from}" height="1" fill="${ink}"/>`,
      ),
      `<rect x="1" y="11" width="14" height="4" rx="2" fill="${ink}"/>`,
    );
  }
  if (size === 32) {
    return svg(
      32,
      `<rect width="32" height="32" rx="6" fill="${orange}"/>`,
      `<rect x="8" y="3" width="15" height="21" rx="1" fill="${paper}"/>`,
      `<path d="${sparkle(15.5, 12.5, 7.5, 2)}" fill="${ink}"/>`,
      `<rect x="1" y="22" width="30" height="7" rx="3.5" fill="${ink}"/>`,
    );
  }
  return svg(
    64,
    `<rect width="64" height="64"${size < 180 ? ' rx="14"' : ''} fill="${orange}"/>`,
    `<rect x="16" y="6" width="32" height="44" rx="2" fill="${paper}"/>`,
    `<path d="${sparkle(32, 25, 13, 3.2)}" fill="${ink}"/>`,
    `<rect x="4" y="44" width="56" height="14" rx="7" fill="${ink}"/>`,
  );
};

/**
 * The content hash in an icon's URL. It covers what the picture is drawn from (the default's drawing itself, or the
 * tenant's bytes by their hash), the size, and for the .ico the sizes inside it, so a cached URL never shows another
 * picture.
 */
export const siteIconHash = (source: SiteIconSource, size: SiteIconSize | 'ico'): string => {
  const sizes = size === 'ico' ? ICO_SIZES : [size];
  const drawings = source.kind === 'default' ? sizes.map(defaultSiteIconSvg) : [];
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
