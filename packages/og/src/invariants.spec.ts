import { describe, expect, it } from 'vitest';

import { PROBES } from './probes.js';
import { renderPng, renderSvg } from './render.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';
import { TEMPLATE_NAMES } from './templates.js';

const SIZES = Object.keys(SHARE_SIZES) as ShareSize[];

/** The SVG's text, joined: satori writes one text element per word or segment. */
const svgText = (svg: string): string =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
    .map((m) => m[1] ?? '')
    .join('')
    .replaceAll('&amp;', '&');

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

/**
 * What every card must show, whatever its template (BRIEF §3, invariant 4; ADR-0003 §8): the canonical address, and
 * on an election's cards the methodology's short address; at the size it says, and small enough for every app.
 */
describe.each(TEMPLATE_NAMES)('every %s card', (template) => {
  it.each(SIZES)(
    'shows the canonical address, and fits every app, at %s',
    async (size) => {
      for (const probe of PROBES[template]) {
        const node = probe.node(size);
        const text = svgText(await renderSvg(node, size, { text: true }));
        expect(text, `${probe.id}: the canonical address`).toContain('ejemplo-a.example.test');
        if (template !== 'coming-soon') {
          expect(text, `${probe.id}: the methodology's address`).toContain(
            'Metodología: ejemplo-a.example.test/elecciones-de-ejemplo/metodologia',
          );
        }
        const png = await renderPng(node, size);
        expect(pngSize(png)).toEqual(SHARE_SIZES[size]);
        // WhatsApp drops previews over about 300 KB.
        expect(png.byteLength).toBeLessThan(300 * 1024);
      }
      // Every probe of the template, drawn twice: seconds on a slow runner, as the reference test allows.
    },
    30_000,
  );
});

describe('a rating on a card', () => {
  it('is its icon and its words, never colour alone (BRIEF §6)', async () => {
    const cell = PROBES.cell.find(({ id }) => id === 'rated');
    const svg = await renderSvg(cell!.node('1200x630'), '1200x630', { text: true });
    expect(svgText(svg)).toContain('CUMPLE PARCIALMENTE');
    expect(svg).toContain('<image');
    // Whatever their case: the party card writes them as words under each criterion (PLAN R185).
    const party = PROBES.party.find(({ id }) => id === 'few');
    const text = svgText(await renderSvg(party!.node('1080x1080'), '1080x1080', { text: true }));
    for (const words of ['CUMPLE', 'NO CUMPLE', 'NO LO MENCIONA']) {
      expect(text.toUpperCase()).toContain(words);
    }
  });

  it('stands for the rows that don\'t fit with "and # more"', async () => {
    const party = PROBES.party.find(({ id }) => id === 'many-logos');
    const text = svgText(await renderSvg(party!.node('1200x630'), '1200x630', { text: true }));
    expect(text).toMatch(/y \d+ más en la web/);
  });
});
