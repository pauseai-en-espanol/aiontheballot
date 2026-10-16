import { Resvg } from '@resvg/resvg-js';

import { imageSize } from './image-size.js';
import {
  defaultSiteIconSvg,
  encodeIco,
  ICO_SIZES,
  SITE_ICON_COLOURS,
  type SiteIconSize,
  tenantSiteIconSvg,
} from './site-icon.js';

/** What an icon is drawn from: the default, or a tenant's PNG already checked by `isUsableSiteIcon`. */
export type SiteIconArt = { kind: 'default' } | { kind: 'tenant'; png: Uint8Array };

const rasterise = (svg: string, side: number): Uint8Array =>
  new Resvg(svg, { fitTo: { mode: 'width', value: side }, font: { loadSystemFonts: false } })
    .render()
    .asPng();

/**
 * A tenant's PNG reduced to `size`. One big step would sample a few source pixels per output pixel, and thin lines
 * would vanish or break up. So it takes one step down to the largest `size` times a power of two the source covers
 * (less than halving), then halves exactly, each step averaging every pixel. From 180 px it lands on white, since home
 * screens fill transparency with black. The result is always redrawn, so nothing of the upload but its pixels (no
 * metadata) is served.
 */
const reduce = (png: Uint8Array, size: SiteIconSize): Uint8Array => {
  const source = imageSize(png)?.width ?? size;
  let start = size;
  while (start * 2 <= source) {
    start *= 2;
  }
  let current = png;
  let side = source;
  let redrawn = false;
  const draw = (to: number, background?: string) => {
    current = rasterise(tenantSiteIconSvg(current, to, background), to);
    side = to;
    redrawn = true;
  };
  if (start !== source) {
    draw(start);
  }
  while (side > size) {
    draw(side / 2);
  }
  if (size >= 180) {
    draw(size, SITE_ICON_COLOURS.background);
  } else if (!redrawn) {
    draw(size);
  }
  return current;
};

/** The icon as a PNG of `size` pixels a side, rasterised by resvg like the share cards. */
export const renderSiteIcon = (art: SiteIconArt, size: SiteIconSize): Uint8Array =>
  art.kind === 'default' ? rasterise(defaultSiteIconSvg(size), size) : reduce(art.png, size);

/** /favicon.ico: the 16, 32 and 48 px icons in one file. */
export const renderFavicon = (art: SiteIconArt): Uint8Array =>
  encodeIco(ICO_SIZES.map((size) => ({ size, png: renderSiteIcon(art, size) })));
