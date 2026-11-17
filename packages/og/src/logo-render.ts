import { Resvg } from '@resvg/resvg-js';

import { imageSize } from './image-size.js';
import { type LogoSide, SHRUNK_TYPES } from './logo-sides.js';

const drawn = (bytes: Uint8Array, type: string, width: number, height: number): Uint8Array =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" ` +
      `preserveAspectRatio="none" href="data:${type};base64,${Buffer.from(bytes).toString('base64')}"/></svg>`,
    { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } },
  )
    .render()
    .asPng();

/**
 * A party's logo redrawn as a PNG whose longer side is at most `side` (PLAN R236): what the site's boxes need, a
 * fraction of what is often uploaded. As for the site icon, it first steps down to `side` times the largest power of
 * two the upload covers, then halves exactly, each step averaging every pixel, so thin lines survive; never enlarged.
 * Always redrawn, so nothing of the upload but its pixels is served. Undefined for what it can't draw (WebP, or bytes
 * that aren't the image they claim), which is then served as uploaded.
 */
export const shrinkLogo = (bytes: Uint8Array, side: LogoSide): Uint8Array | undefined => {
  const image = imageSize(bytes);
  if (!image || !SHRUNK_TYPES.has(image.type) || image.width < 1 || image.height < 1) {
    return undefined;
  }
  const longer = Math.max(image.width, image.height);
  const at = (length: number) => ({
    width: Math.max(1, Math.round((image.width * length) / longer)),
    height: Math.max(1, Math.round((image.height * length) / longer)),
  });
  try {
    let current = bytes;
    let type: string = image.type;
    let length = Math.min(side, longer);
    while (length * 2 <= longer) {
      length *= 2;
    }
    const step = (to: number) => {
      const { width, height } = at(to);
      current = drawn(current, type, width, height);
      type = 'image/png';
      length = to;
    };
    step(length);
    while (length > side) {
      step(length / 2);
    }
    return current;
  } catch {
    return undefined;
  }
};
