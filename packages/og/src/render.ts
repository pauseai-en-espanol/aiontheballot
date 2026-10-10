import type { ReactNode } from 'react';

import { Resvg } from '@resvg/resvg-js';
import satori, { type SatoriOptions } from 'satori';

import type { OgNode } from './node.js';

import { ROBOTO_SLAB_400, SAIRA_CONDENSED_700 } from './fonts.generated.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';

// PauseAI's typefaces, self-hosted (ADR-0003 §8): Fontsource's Latin files (SIL OFL and Apache 2.0, licences in
// fonts/), embedded as base64 so every bundle carries them with no file access. satori reads WOFF, not WOFF2.
let fonts: SatoriOptions['fonts'] | undefined;

const loadFonts = (): SatoriOptions['fonts'] =>
  (fonts ??= [
    {
      name: 'Saira Condensed',
      weight: 700,
      style: 'normal',
      data: Buffer.from(SAIRA_CONDENSED_700, 'base64'),
    },
    {
      name: 'Roboto Slab',
      weight: 400,
      style: 'normal',
      data: Buffer.from(ROBOTO_SLAB_400, 'base64'),
    },
  ]);

/**
 * The card as SVG. `text: true` keeps text as text instead of outlines, for tests that look for it (ADR-0003 §8:
 * the canonical address must appear on every card).
 */
export const renderSvg = async (
  node: OgNode,
  size: ShareSize,
  { text = false }: { text?: boolean } = {},
): Promise<string> =>
  satori(node as unknown as ReactNode, {
    ...SHARE_SIZES[size],
    fonts: loadFonts(),
    embedFont: !text,
  });

/** The card as PNG: satori lays it out, resvg rasterises it. The renderer can be swapped here alone. */
export const renderPng = async (node: OgNode, size: ShareSize): Promise<Uint8Array> => {
  const svg = await renderSvg(node, size);
  return new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
};
