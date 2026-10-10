import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { comingSoonCard, nameLines } from './coming-soon.js';
import { cardHash, TEMPLATE_VERSION } from './hash.js';
import { renderPng, renderSvg } from './render.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';

const card = {
  label: 'Próximamente',
  name: 'Inquilino de ejemplo A',
  question: '¿Qué proponen los partidos frente a los riesgos de la IA?',
  address: 'ejemplo-a.example.test',
  initiative: 'Una iniciativa de Organización de ejemplo A',
};

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

describe('nameLines', () => {
  it('balances the name on two lines, the shorter first', () => {
    expect(nameLines('IA en las urnas')).toEqual(['IA en', 'las urnas']);
    expect(nameLines('AI on the ballot')).toEqual(['AI on', 'the ballot']);
  });

  it('keeps one word on one line', () => {
    expect(nameLines('Ejemplo')).toEqual(['Ejemplo']);
  });
});

describe('the coming-soon card', () => {
  it.each(SIZES)('shows the canonical address, the name and the operator at %s', async (size) => {
    const text = svgText(await renderSvg(comingSoonCard(card, size), size, { text: true }));
    // ADR-0003 §8: the canonical address is on every card. The display face is uppercase, as on the page.
    expect(text).toContain(card.address);
    expect(text).toContain('INQUILINO');
    expect(text).toContain('EJEMPLO A');
    expect(text).toContain(card.initiative);
  });

  it.each(SIZES)('renders a PNG of exactly %s, small enough for every app', async (size) => {
    const png = await renderPng(comingSoonCard(card, size), size);
    expect(pngSize(png)).toEqual(SHARE_SIZES[size]);
    // WhatsApp drops previews over about 300 KB.
    expect(png.byteLength).toBeLessThan(300 * 1024);
  });
});

describe('TEMPLATE_VERSION', () => {
  // The SVG version 1 draws for this card. If a template, satori or a font changes the picture, this fails: bump
  // TEMPLATE_VERSION (so every image gets a new URL instead of a different picture under a cached one) and pin the
  // new digest here.
  const PINNED = {
    version: 1,
    svg: '1d0c5e820bc8916988ea91f2046e324213103cc4ba0836530bcd3c508f7a2b15',
  };

  it('changes whenever the picture does', async () => {
    const svg = await renderSvg(comingSoonCard(card, '1200x630'), '1200x630');
    expect({
      version: TEMPLATE_VERSION,
      svg: createHash('sha256').update(svg).digest('hex'),
    }).toEqual(PINNED);
  });
});

describe('cardHash', () => {
  it('is stable for the same template, size and data, and changes with any of them', () => {
    const base = cardHash('coming-soon', '1200x630', card);
    expect(cardHash('coming-soon', '1200x630', { ...card })).toBe(base);
    expect(cardHash('coming-soon', '1080x1080', card)).not.toBe(base);
    expect(cardHash('coming-soon', '1200x630', { ...card, label: 'Otra' })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{12}$/);
  });
});
