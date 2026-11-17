import { Resvg } from '@resvg/resvg-js';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { imageSize } from './image-size.js';
import { shrinkLogo } from './logo-render.js';

/** A fictional logo: an ink ring with a thin bar on white, `width`×`height`, as a PNG. */
const png = (width: number, height = width): Uint8Array =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="${width}" height="${height}" fill="#ffffff"/>` +
      `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="none" ` +
      `stroke="#111111" stroke-width="${Math.max(1, Math.round(width / 40))}"/></svg>`,
  )
    .render()
    .asPng();

/** The PNG with a text chunk after its header, as an editor writes the author's name or a place into a file. */
const withText = (bytes: Uint8Array, text: string): Uint8Array => {
  const data = Buffer.from(`Comment\0${text}`, 'latin1');
  const type = Buffer.from('tEXt', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length);
  // After the signature (8 bytes) and the IHDR chunk (25).
  return Uint8Array.from(Buffer.concat([bytes.subarray(0, 33), chunk, bytes.subarray(33)]));
};

/** The smallest JPEG: one pixel, as a camera's file would start. */
const JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8X' +
      'GBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
);

/** A one-pixel WebP, which resvg can't draw. */
const WEBP = Uint8Array.from(
  Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'),
);

describe("a party's logo, served small (PLAN R236)", () => {
  it('is redrawn as a PNG no wider or taller than the side asked, its shape kept', () => {
    for (const [width, height, side, expected] of [
      [1024, 1024, 192, [192, 192]],
      [1000, 400, 192, [192, 77]],
      [305, 327, 96, [90, 96]],
      [4096, 512, 96, [96, 12]],
    ] as const) {
      const shrunk = shrinkLogo(png(width, height), side);
      expect(shrunk && imageSize(shrunk), `${width}×${height}`).toMatchObject({
        type: 'image/png',
        width: expected[0],
        height: expected[1],
      });
    }
  });

  it('is much smaller than a large upload', () => {
    const upload = png(1024);
    const shrunk = shrinkLogo(upload, 96);
    expect(shrunk?.byteLength).toBeLessThan(upload.byteLength / 4);
  });

  it('is never enlarged, only redrawn, so nothing of the upload but its pixels is served', () => {
    const upload = withText(png(60, 40), 'Persona de Ejemplo, Calle de Ejemplo 1');
    const shrunk = shrinkLogo(upload, 192);
    expect(shrunk && imageSize(shrunk)).toMatchObject({ width: 60, height: 40 });
    expect(Buffer.from(upload).includes('Calle de Ejemplo')).toBe(true);
    expect(Buffer.from(shrunk ?? []).includes('Calle de Ejemplo')).toBe(false);
  });

  it('draws a JPEG as a PNG', () => {
    const shrunk = shrinkLogo(JPEG, 96);
    expect(shrunk && imageSize(shrunk)).toMatchObject({ type: 'image/png', width: 1, height: 1 });
  });

  it('leaves alone what it cannot draw: a WebP, or bytes that are no image', () => {
    expect(shrinkLogo(WEBP, 96)).toBeUndefined();
    expect(shrinkLogo(new Uint8Array([1, 2, 3]), 96)).toBeUndefined();
  });
});
