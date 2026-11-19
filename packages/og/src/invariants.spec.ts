import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import { describe, expect, it } from 'vitest';

import { overviewCard, type TableCard, tableCard } from './data-cards.js';
import { PROBES } from './probes.js';
import { renderPng, renderSvg } from './render.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';
import { TEMPLATE_NAMES } from './templates.js';
import { DEFAULT_CARD_THEME } from './theme.js';

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

/** The probes' words for each display state. */
const WORDS: Partial<Record<RatingDisplay, string>> = {
  meets: 'Cumple',
  partially_meets: 'Cumple parcialmente',
  does_not_meet: 'No cumple',
  not_mentioned: 'No lo menciona',
  pending: 'Pendiente de evaluar',
  withdrawn: 'Valoración retirada',
};
const STATES = Object.keys(WORDS) as RatingDisplay[];

/** Long, invented short titles, as a chapter's may be: the criteria's key must still be whole. */
const LONG_TITLES = [
  'Criterio de ejemplo uno',
  'Segundo criterio inventado',
  'Ejemplo de criterio tres',
  'Cuarto criterio de prueba',
  'Criterio inventado número cinco',
  'Sexto ejemplo',
  'Séptimo criterio de ejemplo',
  'Ocho',
  'Noveno criterio inventado',
  'Décimo criterio de prueba',
];

/** Invented short titles about as long as the live election's: too long to go across ten columns (PLAN R246). */
const MEDIUM_TITLES = [
  'Criterio de ejemplo',
  'Ejemplo de criterio',
  'Tercer criterio inventado',
  'Cuarto ejemplo',
  'Quinto criterio de prueba',
  'Sexto',
  'Séptimo ejemplo',
  'Octavo',
  'Noveno ejemplo',
  'Décimo criterio',
];

/**
 * The whole table's data for so many parties and criteria, every state in turn, with names too short to cut, and the
 * criteria short or, with `titles`, those titles numbered.
 */
const tableData = (parties: number, criteria: number, titles?: readonly string[]): TableCard => ({
  theme: DEFAULT_CARD_THEME,
  site: 'Inquilino de ejemplo A',
  letters: 'IA' as const,
  election: 'Elecciones de ejemplo',
  address: 'ejemplo-a.example.test',
  methodology: 'Metodología: ejemplo-a.example.test/x',
  initiative: 'Una iniciativa de Organización de ejemplo A',
  initiativeLead: 'Una iniciativa de',
  dataDate: 'Datos del 1 de enero',
  title: '¿Cumplen los partidos de ejemplo?',
  subtitle: 'Elecciones de ejemplo',
  parties: Array.from({ length: parties }, (_, i) => {
    const short = `PE${String.fromCharCode(65 + i)}`;
    return { short, name: short, colour: null };
  }),
  criteria: Array.from({ length: criteria }, (_, j) =>
    titles ? `${titles[j % titles.length]} ${j + 1}` : `Ejemplo ${j + 1}`,
  ),
  cells: Array.from({ length: parties }, (_, i) =>
    Array.from({ length: criteria }, (__, j) => {
      const rating = STATES[(i + j) % STATES.length] ?? 'pending';
      return { rating, label: WORDS[rating] ?? '' };
    }),
  ),
  legend: STATES.slice(0, 5).map((rating) => ({ rating, label: WORDS[rating] ?? '' })),
});

const wholeTable = (parties: number, criteria: number, size: ShareSize) =>
  tableCard(tableData(parties, criteria), size);

describe("the whole table's words", () => {
  // Arturo, on the demo's table (11 parties, 10 criteria): it read "No lo" and "Cumple", cut (PLAN R216).
  it.each([
    [3, 4],
    [5, 6],
    [11, 10],
    [11, 17],
    [20, 12],
  ])(
    'are whole under each icon, or left to the legend, never cut: %i parties, %i criteria',
    async (parties, criteria) => {
      for (const size of SIZES) {
        const text = svgText(
          await renderSvg(wholeTable(parties, criteria, size), size, { text: true }),
        );
        expect(text, size).not.toContain('…');
      }
    },
    30_000,
  );

  // The demo's portrait table cut its key after the eighth criterion of ten (PLAN R221): the legend took more room
  // than it was given, and the key gave it up.
  it.each([
    [11, 10],
    [11, 17],
    [5, 12],
  ])(
    "leave the criteria's key whole, however long their titles: %i parties, %i criteria",
    async (parties, criteria) => {
      for (const size of SIZES) {
        const data = tableData(parties, criteria, LONG_TITLES);
        const preview = overviewCard(
          {
            ...data,
            cells: data.cells.map((row) => row.map(({ rating }) => rating)),
            more: 'y # más en la web',
          },
          size,
        );
        for (const [kind, node] of [
          ['table', tableCard(data, size)],
          ['preview', preview],
        ] as const) {
          const text = svgText(await renderSvg(node, size, { text: true }));
          expect(text, `${kind} ${size}`).not.toContain('…');
          // Numbered columns are keyed below; columns wide enough say their titles themselves.
          if (/\d+\. /.test(text)) {
            for (let j = 0; j < criteria; j += 1) {
              const entry = `${j + 1}. ${LONG_TITLES[j % LONG_TITLES.length]} ${j + 1}`;
              expect(text, `${kind} ${size}: ${entry}`).toMatch(
                new RegExp(entry.replaceAll('.', '\\.').replaceAll(' ', ' ?')),
              );
            }
          }
        }
      }
    },
    30_000,
  );

  it('are written where they fit', async () => {
    const text = svgText(
      await renderSvg(wholeTable(3, 4, '1080x1350'), '1080x1350', { text: true }),
    );
    for (const words of ['No lo menciona', 'Cumple parcialmente', 'Pendiente de evaluar']) {
      // A line break between two words leaves no space in the SVG's text.
      expect(text).toMatch(new RegExp(words.replaceAll(' ', ' ?')));
    }
  });
});

/** The card's side margins, as its layouts set them: no title reaches into them. */
const MARGIN: Record<ShareSize, number> = {
  '1200x630': 44,
  '1080x1080': 56,
  '1080x1350': 56,
  '1080x1920': 72,
};

/** A word satori turned 45° up: its place, size and turn (the matrix of rotate(-45deg) about its origin). */
const TILTED =
  /<text x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*transform="matrix\((0\.7071\d*),(-0\.7071\d*),([\d.-]+),([\d.-]+),([\d.-]+),([\d.-]+)\)"/g;

/**
 * Where on the card each tilted word is drawn: its glyphs' box (an em above the baseline, a third of one below) with
 * its corners turned as satori turns them.
 */
const tiltedWords = (svg: string) =>
  [...svg.matchAll(TILTED)].map((match) => {
    const [x, y, width, size, a, b, c, d, e, f] = match.slice(1).map(Number) as number[] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const corners = [
      [x, y - size],
      [x + width, y - size],
      [x, y + size / 3],
      [x + width, y + size / 3],
    ].map(([px = 0, py = 0]) => ({ x: a * px + c * py + e, y: b * px + d * py + f }));
    return {
      right: Math.max(...corners.map((corner) => corner.x)),
      top: Math.min(...corners.map((corner) => corner.y)),
    };
  });

/** The accent header's height: a card's body starts under it. */
const headerHeight = (svg: string): number =>
  Number(
    new RegExp(
      `<rect x="0" y="0" width="\\d+" height="([\\d.]+)" fill="${DEFAULT_CARD_THEME.accent}"/>`,
    ).exec(svg)?.[1],
  );

/** The table and the scorecard's link preview of the same data. */
const bothGrids = (data: TableCard, size: ShareSize) =>
  [
    ['table', tableCard(data, size)],
    [
      'preview',
      overviewCard(
        {
          ...data,
          cells: data.cells.map((row) => row.map(({ rating }) => rating)),
          more: 'y # más en la web',
        },
        size,
      ),
    ],
  ] as const;

// Feedback on the live 29N site: on the shared table, which column was which was only in the key below (PLAN R246).
describe("the criteria's titles, where they don't fit across", () => {
  it.each(['1080x1350', '1080x1920'] as const)(
    'are tilted over their columns, whole, where every party keeps a row: 15 parties, 10 criteria at %s',
    async (size) => {
      const data = tableData(15, 10, MEDIUM_TITLES);
      const svg = await renderSvg(tableCard(data, size), size, { text: true });
      const text = svgText(svg);
      expect(tiltedWords(svg).length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\d+\. /);
      expect(text).not.toContain('…');
      for (const title of data.criteria) {
        expect(text).toMatch(new RegExp(title.replaceAll(' ', ' ?')));
      }
    },
  );

  it('are numbered and keyed where tilting them would leave the rows too low: 20 parties at 1080x1080', async () => {
    const svg = await renderSvg(
      tableCard(tableData(20, 10, MEDIUM_TITLES), '1080x1080'),
      '1080x1080',
      { text: true },
    );
    expect(tiltedWords(svg)).toEqual([]);
    expect(svgText(svg)).toMatch(/1\. Criterio de ejemplo 1/);
  });

  it.each([
    [3, 4],
    [11, 10],
    [15, 10],
    [11, 17],
    [5, 12],
    [20, 12],
  ])(
    'stay on the card when tilted, under its header and clear of its margin: %i parties, %i criteria',
    async (parties, criteria) => {
      for (const titles of [undefined, MEDIUM_TITLES, LONG_TITLES]) {
        for (const size of SIZES) {
          for (const [kind, node] of bothGrids(tableData(parties, criteria, titles), size)) {
            const svg = await renderSvg(node, size, { text: true });
            const header = headerHeight(svg);
            expect(header, `${kind} ${size}: the header`).toBeGreaterThan(0);
            for (const word of tiltedWords(svg)) {
              expect(word.right, `${kind} ${size}`).toBeLessThanOrEqual(
                SHARE_SIZES[size].width - MARGIN[size] + 1,
              );
              expect(word.top, `${kind} ${size}`).toBeGreaterThanOrEqual(header);
            }
          }
        }
      }
    },
    30_000,
  );

  it.each([5, 11, 15, 20])(
    'leave every party on the link preview when tilted, none to "and # more": %i parties',
    async (parties) => {
      for (const titles of [undefined, MEDIUM_TITLES, LONG_TITLES]) {
        for (const size of SIZES) {
          const [, [, preview]] = bothGrids(tableData(parties, 10, titles), size);
          const svg = await renderSvg(preview, size, { text: true });
          if (tiltedWords(svg).length > 0) {
            expect(svgText(svg), size).not.toMatch(/y \d+ más en la web/);
          }
        }
      }
    },
    30_000,
  );
});
