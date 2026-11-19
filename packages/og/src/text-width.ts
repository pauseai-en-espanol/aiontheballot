import { inflateSync } from 'node:zlib';

import { ROBOTO_SLAB_400, SAIRA_CONDENSED_700 } from './fonts.generated.js';

/**
 * How wide a line of text is drawn, from the embedded fonts' own advance widths (their `cmap` and `hmtx` tables), for
 * layouts that must know before satori lays them out: a title tilted over its column (PLAN R246). Kerning is left
 * out; satori shapes with it, which in these fonts mostly tightens, so the measure is a little wider than the text,
 * never much narrower. A character the font lacks counts as an em.
 */

export type CardFont = 'Saira Condensed' | 'Roboto Slab';

interface Metrics {
  unitsPerEm: number;
  /** Each character's advance, in font units. */
  advances: Map<number, number>;
}

/** A WOFF file's tables, by tag, inflated where WOFF compressed them. */
const tables = (woff: Buffer): Map<string, Buffer> => {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') {
    throw new Error('Not a WOFF file');
  }
  const found = new Map<string, Buffer>();
  for (let i = 0; i < woff.readUInt16BE(12); i += 1) {
    const entry = 44 + i * 20;
    const offset = woff.readUInt32BE(entry + 4);
    const compressed = woff.readUInt32BE(entry + 8);
    const original = woff.readUInt32BE(entry + 12);
    const data = woff.subarray(offset, offset + compressed);
    found.set(
      woff.toString('latin1', entry, entry + 4),
      compressed < original ? inflateSync(data) : data,
    );
  }
  return found;
};

/** The glyph of every character a `cmap` subtable maps, for formats 4 (the basic plane) and 12 (all of Unicode). */
const glyphsOf = (cmap: Buffer): Map<number, number> => {
  const glyphs = new Map<number, number>();
  const records = Array.from({ length: cmap.readUInt16BE(2) }, (_, i) => ({
    platform: cmap.readUInt16BE(4 + i * 8),
    encoding: cmap.readUInt16BE(6 + i * 8),
    offset: cmap.readUInt32BE(8 + i * 8),
  }));
  // Windows Unicode, the full repertoire first; then Unicode's own platform.
  const record =
    records.find((r) => r.platform === 3 && r.encoding === 10) ??
    records.find((r) => r.platform === 3 && r.encoding === 1) ??
    records.find((r) => r.platform === 0);
  if (!record) {
    return glyphs;
  }
  const table = cmap.subarray(record.offset);
  const format = table.readUInt16BE(0);
  if (format === 12) {
    for (let i = 0; i < table.readUInt32BE(12); i += 1) {
      const group = 16 + i * 12;
      const start = table.readUInt32BE(group);
      const glyph = table.readUInt32BE(group + 8);
      for (let c = start; c <= table.readUInt32BE(group + 4); c += 1) {
        glyphs.set(c, glyph + c - start);
      }
    }
  } else if (format === 4) {
    const segments = table.readUInt16BE(6) / 2;
    const ends = 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    for (let s = 0; s < segments; s += 1) {
      const start = table.readUInt16BE(starts + s * 2);
      const delta = table.readInt16BE(deltas + s * 2);
      const rangeOffset = table.readUInt16BE(rangeOffsets + s * 2);
      for (let c = start; c <= table.readUInt16BE(ends + s * 2) && c !== 0xffff; c += 1) {
        // Glyph 0 is the missing glyph: through the glyph array, before the delta, it maps nothing.
        const listed =
          rangeOffset === 0
            ? c
            : table.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (c - start) * 2);
        const glyph = rangeOffset !== 0 && listed === 0 ? 0 : (listed + delta) & 0xffff;
        if (glyph !== 0) {
          glyphs.set(c, glyph);
        }
      }
    }
  }
  return glyphs;
};

const metricsOf = (base64: string): Metrics => {
  const font = tables(Buffer.from(base64, 'base64'));
  const head = font.get('head');
  const hhea = font.get('hhea');
  const hmtx = font.get('hmtx');
  const cmap = font.get('cmap');
  if (!head || !hhea || !hmtx || !cmap) {
    throw new Error('A font without head, hhea, hmtx or cmap');
  }
  const metrics = hhea.readUInt16BE(34);
  // Glyphs past the last metric share its advance.
  const advance = (glyph: number) => hmtx.readUInt16BE(Math.min(glyph, metrics - 1) * 4);
  return {
    unitsPerEm: head.readUInt16BE(18),
    advances: new Map([...glyphsOf(cmap)].map(([c, glyph]) => [c, advance(glyph)])),
  };
};

const SOURCES: Record<CardFont, string> = {
  'Saira Condensed': SAIRA_CONDENSED_700,
  'Roboto Slab': ROBOTO_SLAB_400,
};
const loaded = new Map<CardFont, Metrics>();

/** The width of `text` on one line at `size` px in `font`, as the card's fonts draw it (kerning aside). */
export const textWidth = (text: string, size: number, font: CardFont): number => {
  let metrics = loaded.get(font);
  if (!metrics) {
    metrics = metricsOf(SOURCES[font]);
    loaded.set(font, metrics);
  }
  let units = 0;
  for (const character of text.normalize('NFC')) {
    units += metrics.advances.get(character.codePointAt(0) ?? 0) ?? metrics.unitsPerEm;
  }
  return (units / metrics.unitsPerEm) * size;
};
