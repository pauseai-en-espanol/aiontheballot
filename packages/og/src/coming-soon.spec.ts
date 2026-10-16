import { Resvg } from '@resvg/resvg-js';
import { describe, expect, it } from 'vitest';

import { comingSoonCard, nameLines } from './coming-soon.js';
import { renderPng, renderSvg } from './render.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';
import { DEFAULT_CARD_THEME } from './theme.js';

const card = {
  theme: DEFAULT_CARD_THEME,
  label: 'Próximamente',
  name: 'Inquilino de ejemplo A',
  question: '¿Qué proponen los partidos frente a los riesgos de la IA?',
  address: 'ejemplo-a.example.test',
  initiative: 'Una iniciativa de Organización de ejemplo A',
  initiativeLead: 'Una iniciativa de',
};

/** A fictional logo: an ink bar on transparency, 300×80. */
const logoPng = (): Uint8Array =>
  new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><rect x="0" y="20" width="300" height="40" fill="#111111"/></svg>',
  )
    .render()
    .asPng();
const logo = () => {
  const png = logoPng();
  return {
    src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    width: 300,
    height: 80,
  };
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

describe("the operator's logo", () => {
  it('replaces the operator line, after its lead', async () => {
    const withLogo = {
      ...card,
      operatorLogo: { sha256: 'a'.repeat(64), contentType: 'image/png' },
    };
    const svg = await renderSvg(
      comingSoonCard(withLogo, '1200x630', { operatorLogo: logo() }),
      '1200x630',
      {
        text: true,
      },
    );
    expect(svgText(svg)).toContain('Una iniciativa de');
    expect(svgText(svg)).not.toContain('Organización de ejemplo A');
    expect(svg).toContain('<image');
  });

  it('falls back to the line in words when the image is missing', async () => {
    const withLogo = {
      ...card,
      operatorLogo: { sha256: 'a'.repeat(64), contentType: 'image/png' },
    };
    const svg = await renderSvg(comingSoonCard(withLogo, '1200x630'), '1200x630', { text: true });
    expect(svgText(svg)).toContain(card.initiative);
  });

  it.each(SIZES)('renders at %s', async (size) => {
    const png = await renderPng(
      comingSoonCard(
        { ...card, operatorLogo: { sha256: 'a'.repeat(64), contentType: 'image/png' } },
        size,
        {
          operatorLogo: logo(),
        },
      ),
      size,
    );
    expect(pngSize(png)).toEqual(SHARE_SIZES[size]);
  });
});
