import { palette } from '@aiontheballot/ui/brand';
import { AA_TEXT, contrastRatio } from '@aiontheballot/ui/contrast';
import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { imageSize } from './image-size.js';
import { renderFavicon, renderSiteIcon } from './site-icon-render.js';
import {
  DEFAULT_SITE_ICON,
  defaultSiteIconSvg,
  encodeIco,
  isCompletePng,
  isServedSiteIconSize,
  isUsableSiteIcon,
  SITE_ICON_SIZES,
  SITE_ICON_VERSION,
  siteIconHash,
} from './site-icon.js';

const svgPng = (svg: string): Uint8Array => new Resvg(svg).render().asPng();

/** A fictional square mark: an ink circle on white, `width`×`height`. */
const png = (width: number, height = width): Uint8Array =>
  svgPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
      `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#111111"/></svg>`,
  );

/** The same PNG claiming other dimensions in its header: what a crafted upload could declare. */
const declaring = (bytes: Uint8Array, width: number, height: number): Uint8Array => {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return copy;
};

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

interface Handmade {
  colour?: number;
  depth?: number;
  interlace?: number;
  compression?: number;
  filterMethod?: number;
  /** The filter byte every row starts with. */
  rowFilter?: number;
  /** Inflated data of this many bytes, instead of what the header asks for. */
  length?: number;
  /** A palette chunk, by default only for colour type 3. */
  palette?: boolean;
  /** Chunks inserted: before IHDR, between two image data chunks, or before IEND. */
  first?: string;
  between?: string;
  last?: string;
}

/** A PNG built chunk by chunk with blank pixels, to break one rule at a time. */
const handmadePng = (side: number, options: Handmade = {}): Uint8Array => {
  const { colour = 0, depth = 8, interlace = 0, compression = 0, filterMethod = 0 } = options;
  const chunk = (type: string, data: Uint8Array = new Uint8Array()) => {
    const out = new Uint8Array(12 + data.byteLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.byteLength);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header.set([depth, colour, compression, filterMethod, interlace], 8);
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : colour === 4 ? 2 : 1;
  const passes = interlace
    ? ADAM7.map(([x, y, dx, dy]) => [Math.ceil((side - x) / dx), Math.ceil((side - y) / dy)])
    : [[side, side]];
  const rows: Uint8Array[] = [];
  for (const [w = 0, h = 0] of passes) {
    for (let row = 0; w > 0 && row < h; row += 1) {
      const bytes = new Uint8Array(Math.ceil((w * channels * depth) / 8) + 1);
      bytes[0] = options.rowFilter ?? 0;
      rows.push(bytes);
    }
  }
  const raw = options.length === undefined ? Buffer.concat(rows) : new Uint8Array(options.length);
  const compressed = deflateSync(raw);
  const half = Math.floor(compressed.byteLength / 2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...(options.first ? [chunk(options.first)] : []),
    chunk('IHDR', header),
    ...((options.palette ?? colour === 3)
      ? [chunk('PLTE', new Uint8Array([0, 0, 0, 255, 255, 255]))]
      : []),
    chunk('IDAT', compressed.subarray(0, half)),
    ...(options.between ? [chunk(options.between)] : []),
    chunk('IDAT', compressed.subarray(half)),
    ...(options.last ? [chunk(options.last)] : []),
    chunk('IEND'),
  ]);
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The pixels of a PNG, one RGBA quadruple each, decoded by drawing it at its own size. */
const pixelsOf = (bytes: Uint8Array, side: number): Uint8Array =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><image width="${side}" height="${side}" image-rendering="optimizeSpeed" href="data:image/png;base64,${Buffer.from(bytes).toString('base64')}"/></svg>`,
  ).render().pixels;

const hex = (pixels: Uint8Array, side: number, x: number, y: number): string => {
  const at = (y * side + x) * 4;
  return `#${[...pixels.subarray(at, at + 3)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

const meanGrey = (pixels: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += pixels[i] ?? 0;
  }
  return sum / (pixels.length / 4);
};

describe("a tenant's icon", () => {
  it('is used only if it is a square PNG between 512 and 1,024 pixels a side', () => {
    expect(isUsableSiteIcon(png(512))).toBe(true);
    expect(isUsableSiteIcon(png(1024))).toBe(true);
    expect(isUsableSiteIcon(png(511))).toBe(false);
    expect(isUsableSiteIcon(png(180))).toBe(false);
    expect(isUsableSiteIcon(png(1025))).toBe(false);
    expect(isUsableSiteIcon(png(600, 512))).toBe(false);
    // Not a PNG, whatever it was uploaded as: a JPEG whose frame header says 512×512.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 0, 2, 0, 3, 1, 0x22, 0, 2, 0x11, 1,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 512, height: 512, type: 'image/jpeg' });
    expect(isUsableSiteIcon(jpeg)).toBe(false);
    expect(isUsableSiteIcon(new TextEncoder().encode('<svg/>'))).toBe(false);
  });

  it('is refused when its header claims more than its pixels hold', () => {
    expect(isUsableSiteIcon(declaring(png(512), 1024, 1024))).toBe(false);
    expect(isUsableSiteIcon(declaring(png(512), 4096, 4096))).toBe(false);
  });

  it.each([
    ['cut after its header', 40],
    ['cut in the middle', 1500],
    ['missing only its last chunk', -12],
  ])('is refused %s, which would otherwise draw nothing at all', (_name, cut) => {
    const whole = png(512);
    expect(isCompletePng(whole)).toBe(true);
    const cutShort = whole.slice(0, cut < 0 ? whole.byteLength + cut : cut);
    expect(imageSize(cutShort)).toEqual({ width: 512, height: 512, type: 'image/png' });
    expect(isUsableSiteIcon(cutShort)).toBe(false);
  });

  it('is refused when damaged, or with anything after its end', () => {
    const damaged = png(512);
    damaged[60] = (damaged[60] ?? 0) ^ 0xff;
    expect(isUsableSiteIcon(damaged)).toBe(false);
    // Damage only a checksum: the pixels would still inflate, but the file isn't what was written.
    const checksum = png(512);
    checksum[checksum.byteLength - 1] = (checksum[checksum.byteLength - 1] ?? 0) ^ 0xff;
    expect(isUsableSiteIcon(checksum)).toBe(false);
    expect(isUsableSiteIcon(Buffer.concat([png(512), Buffer.from('extra')]))).toBe(false);
  });

  it('may be interlaced, of any colour type and depth the format allows, as long as it is whole', () => {
    expect(isCompletePng(handmadePng(512))).toBe(true);
    expect(isCompletePng(handmadePng(512, { interlace: 1 }))).toBe(true);
    expect(isCompletePng(handmadePng(512, { colour: 6, depth: 16 }))).toBe(true);
    expect(isCompletePng(handmadePng(512, { colour: 3, depth: 4, interlace: 1 }))).toBe(true);
    expect(isCompletePng(handmadePng(512, { colour: 0, depth: 1, rowFilter: 4 }))).toBe(true);
    expect(isCompletePng(handmadePng(512, { last: 'tEXt' }))).toBe(true);
  });

  it.each<[string, Handmade]>([
    ['data shorter than its header says', { length: 513 * 511 }],
    ['interlaced data of the wrong length', { interlace: 1, length: 513 * 512 }],
    ['an unknown colour type', { colour: 5 }],
    ['RGB at one bit', { colour: 2, depth: 1 }],
    ['grey at three bits', { depth: 3 }],
    ['a depth that would inflate to hundreds of megabytes', { colour: 6, depth: 255, length: 10 }],
    ['an unknown compression method', { compression: 1 }],
    ['an unknown filter method', { filterMethod: 1 }],
    ['a row with an unknown filter', { rowFilter: 7 }],
    ['a palette image without its palette', { colour: 3, palette: false }],
    ['image data split by another chunk', { between: 'tEXt' }],
    ['a critical chunk no decoder knows', { last: 'ABCD' }],
    ['anything before its header', { first: 'tEXt' }],
  ])('is refused with %s', (_name, options) => {
    expect(isCompletePng(handmadePng(512, options))).toBe(false);
  });

  it('is reduced by averaging, so fine lines turn grey instead of vanishing or turning black', () => {
    // Four-pixel black lines every 16 pixels on white: a quarter black, so a mean grey of about 191.
    const lines = Array.from(
      { length: 32 },
      (_, i) => `<rect x="${i * 16}" width="4" height="512"/>`,
    );
    const pattern = svgPng(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#fff"/>${lines.join('')}</svg>`,
    );
    for (const side of [16, 32] as const) {
      const grey = meanGrey(pixelsOf(renderSiteIcon({ kind: 'tenant', png: pattern }, side), side));
      expect(grey, `${side} px`).toBeGreaterThan(170);
      expect(grey, `${side} px`).toBeLessThan(212);
    }
  });

  it('is reduced evenly from an odd size too', () => {
    // Two-pixel black lines every eight pixels, 1,023 px: a quarter black again.
    const lines = Array.from(
      { length: 128 },
      (_, i) => `<rect x="${i * 8}" width="2" height="1023"/>`,
    );
    const pattern = svgPng(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1023" height="1023"><rect width="1023" height="1023" fill="#fff"/>${lines.join('')}</svg>`,
    );
    for (const side of [16, 32] as const) {
      const pixels = pixelsOf(renderSiteIcon({ kind: 'tenant', png: pattern }, side), side);
      const greys = Array.from(
        { length: side },
        (_, x) => pixels[(Math.floor(side / 2) * side + x) * 4] ?? 0,
      );
      expect(meanGrey(pixels), `${side} px`).toBeGreaterThan(170);
      expect(meanGrey(pixels), `${side} px`).toBeLessThan(212);
      // Even: no column far from the rest, as banding would leave.
      expect(Math.max(...greys) - Math.min(...greys), `${side} px`).toBeLessThan(40);
    }
  });

  it('lands on white from 180 px, where home screens would fill transparency with black', () => {
    const transparent = svgPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="128" fill="#0b7a75"/></svg>',
    );
    const large = pixelsOf(renderSiteIcon({ kind: 'tenant', png: transparent }, 180), 180);
    expect([hex(large, 180, 0, 0), large[3]]).toEqual(['#ffffff', 255]);
    // A tab's icon keeps its transparency.
    expect(pixelsOf(renderSiteIcon({ kind: 'tenant', png: transparent }, 32), 32)[3]).toBe(0);
  });

  it('keeps its own picture at every size: its colours where they are', () => {
    // A teal tile with a white square in the middle, 512 px.
    const mark = svgPng(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0b7a75"/><rect x="128" y="128" width="256" height="256" fill="#ffffff"/></svg>',
    );
    for (const side of [16, 32, 180, 192, 512] as const) {
      const pixels = pixelsOf(renderSiteIcon({ kind: 'tenant', png: mark }, side), side);
      expect(hex(pixels, side, 1, 1), `${side} px corner`).toBe('#0b7a75');
      expect(hex(pixels, side, side / 2, side / 2), `${side} px middle`).toBe('#ffffff');
    }
  });
});

describe('the default icon', () => {
  it('hashes what it is drawn from and its size, so a cached URL never shows another picture', () => {
    const tenant = { kind: 'tenant', sha256: 'a'.repeat(64) } as const;
    expect(siteIconHash(DEFAULT_SITE_ICON, 32)).toMatch(/^[0-9a-f]{12}$/);
    expect(siteIconHash(DEFAULT_SITE_ICON, 32)).toBe(siteIconHash({ kind: 'default' }, 32));
    expect(
      new Set([
        siteIconHash(DEFAULT_SITE_ICON, 32),
        siteIconHash(DEFAULT_SITE_ICON, 180),
        siteIconHash(DEFAULT_SITE_ICON, 'ico'),
        siteIconHash(tenant, 32),
        siteIconHash(tenant, 'ico'),
        siteIconHash({ kind: 'tenant', sha256: 'b'.repeat(64) }, 32),
      ]).size,
    ).toBe(6);
  });

  it('draws the same pictures for this version', () => {
    expect({
      version: SITE_ICON_VERSION,
      ...Object.fromEntries(
        SITE_ICON_SIZES.map((size) => [size, sha256(defaultSiteIconSvg(size))]),
      ),
    }).toEqual({
      version: 1,
      16: 'fe8e413d6f355557e1b2f8afcebe50e79fbb7635d8a8d88ee0029f26045f9dd6',
      32: 'f0835796f47556c6b9eb4d536d68227efc27487067af15168227b7be75c48995',
      48: 'cf8216943fdde79562cdbb64cb18f4c7794ee74193e185143f01ba1789f4e08d',
      180: '0a3875d7d6ec98a9aae6bbd1723a6cbd2be9a2d23b6dbea271cf95d9caff14d3',
      192: '0a3875d7d6ec98a9aae6bbd1723a6cbd2be9a2d23b6dbea271cf95d9caff14d3',
      512: '0a3875d7d6ec98a9aae6bbd1723a6cbd2be9a2d23b6dbea271cf95d9caff14d3',
    });
  });

  it('has no text in it', () => {
    for (const size of SITE_ICON_SIZES) {
      expect(defaultSiteIconSvg(size)).not.toMatch(/<text|<tspan/);
    }
  });

  it('draws its marks in ink, on its own tile and on the ballot', () => {
    expect(contrastRatio(palette.ink, palette.orange)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(palette.ink, palette.paper)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('lands on whole pixels at 16 px: tile, ballot, the sparkle and its arms, the slot', () => {
    const pixels = pixelsOf(renderSiteIcon({ kind: 'default' }, 16), 16);
    const at = (x: number, y: number) => hex(pixels, 16, x, y);
    expect(at(1, 4)).toBe(palette.orange.toLowerCase());
    expect([at(4, 2), at(5, 4), at(10, 9)]).toEqual(Array(3).fill(palette.paper.toLowerCase()));
    expect([at(7, 6), at(7, 3), at(7, 9), at(4, 6), at(10, 6)]).toEqual(
      Array(5).fill(palette.ink.toLowerCase()),
    );
    expect(at(8, 13)).toBe(palette.ink.toLowerCase());
  });

  it('lands on whole pixels at 32 px: a one-pixel spine for the sparkle, paper either side', () => {
    const pixels = pixelsOf(renderSiteIcon({ kind: 'default' }, 32), 32);
    const at = (x: number, y: number) => hex(pixels, 32, x, y);
    expect([at(15, 9), at(15, 12), at(15, 15), at(11, 12), at(19, 12)]).toEqual(
      Array(5).fill(palette.ink.toLowerCase()),
    );
    expect([at(13, 8), at(17, 8), at(9, 4), at(21, 20)]).toEqual(
      Array(4).fill(palette.paper.toLowerCase()),
    );
    expect(at(3, 12)).toBe(palette.orange.toLowerCase());
    expect(at(15, 26)).toBe(palette.ink.toLowerCase());
  });

  it('fills the square from 180 px, since home screens cut their own corners', () => {
    const pixels = pixelsOf(renderSiteIcon({ kind: 'default' }, 180), 180);
    expect(hex(pixels, 180, 0, 0)).toBe(palette.orange.toLowerCase());
    expect(pixels[3]).toBe(255);
    // A tab's 48 px keeps its rounded corners.
    expect(pixelsOf(renderSiteIcon({ kind: 'default' }, 48), 48)[3]).toBe(0);
  });

  it.each(SITE_ICON_SIZES)('renders the default and a tenant icon at %i px', (size) => {
    for (const art of [{ kind: 'default' }, { kind: 'tenant', png: png(600) }] as const) {
      expect(imageSize(renderSiteIcon(art, size))).toEqual({
        width: size,
        height: size,
        type: 'image/png',
      });
    }
  });

  it('is served at 16, 32, 180, 192 and 512 px; 48 only inside the .ico', () => {
    expect([16, 32, 180, 192, 512].every(isServedSiteIconSize)).toBe(true);
    expect([48, 64].some(isServedSiteIconSize)).toBe(false);
  });
});

describe('/favicon.ico', () => {
  it('holds the 16, 32 and 48 px PNGs behind a valid icon directory', () => {
    const ico = renderFavicon({ kind: 'default' });
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([
      0, 1, 3,
    ]);
    const sizes = [0, 1, 2].map((index) => {
      const entry = 6 + 16 * index;
      const [length, offset] = [view.getUint32(entry + 8, true), view.getUint32(entry + 12, true)];
      const image = ico.subarray(offset, offset + length);
      expect(imageSize(image)?.width).toBe(view.getUint8(entry));
      return view.getUint8(entry);
    });
    expect(sizes).toEqual([16, 32, 48]);
  });

  it('writes 0 for a 256 px side, as the format says', () => {
    const ico = encodeIco([{ size: 256, png: png(256) }]);
    expect(ico[6]).toBe(0);
    expect(ico[7]).toBe(0);
  });
});
