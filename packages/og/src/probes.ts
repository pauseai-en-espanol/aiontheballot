import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import { Resvg } from '@resvg/resvg-js';

import type { OgNode } from './node.js';
import type { ShareSize } from './sizes.js';
import type { TemplateName } from './templates.js';

import { type ComingSoonCard, comingSoonCard } from './coming-soon.js';
import {
  type CardParty,
  criterionCard,
  type DataFrame,
  type DataRow,
  overviewCard,
  partyCard,
  tableCard,
} from './data-cards.js';
import { type CardFrame, cellCard, correctionsCard, methodologyCard } from './election-cards.js';
import { cardTheme, DEFAULT_CARD_THEME } from './theme.js';

/**
 * Fictional cards that exercise what each template can draw: rendered at every size to fingerprint the template at
 * build time, and compared with the committed reference pictures in tests. Never real names or content.
 */
export interface Probe {
  /** Unique within its template: part of the reference picture's file name. */
  id: string;
  node: (size: ShareSize) => OgNode;
}

/** A fictional logo: an ink bar and a dot on transparency, 300×80, drawn the same way every time. */
const probeLogo = (): { src: string; width: number; height: number } => {
  const png = new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80">' +
      '<rect x="0" y="20" width="220" height="40" fill="#111111"/><circle cx="270" cy="40" r="26" fill="#111111"/>' +
      '</svg>',
  )
    .render()
    .asPng();
  return {
    src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    width: 300,
    height: 80,
  };
};

/** Another fictional logo, square: an ink ring, 96×96, for a logo of another shape. */
const probeSquareLogo = (): { src: string; width: number; height: number } => {
  const png = new Resvg(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
      '<circle cx="48" cy="48" r="36" fill="none" stroke="#111111" stroke-width="16"/>' +
      '</svg>',
  )
    .render()
    .asPng();
  return {
    src: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
    width: 96,
    height: 96,
  };
};

const COMING_SOON: ComingSoonCard = {
  theme: DEFAULT_CARD_THEME,
  label: 'Próximamente · Elecciones de ejemplo, domingo 1 de enero',
  name: 'Inquilino de ejemplo A',
  question: '¿Qué proponen los partidos de ejemplo frente a los riesgos de la IA?',
  address: 'ejemplo-a.example.test',
  initiative: 'Una iniciativa de Organización de ejemplo A',
  initiativeLead: 'Una iniciativa de',
};

const FRAME: CardFrame = {
  theme: DEFAULT_CARD_THEME,
  site: 'Inquilino de ejemplo A',
  election: 'Elecciones de ejemplo · domingo, 1 de enero',
  address: 'ejemplo-a.example.test',
  methodology: 'Metodología: ejemplo-a.example.test/elecciones-de-ejemplo/metodologia',
  initiative: 'Una iniciativa de Organización de ejemplo A',
  initiativeLead: 'Una iniciativa de',
  updated: 'Actualizado el 1 de enero',
};
const WITH_LOGO: Partial<CardFrame> = {
  operatorLogo: { sha256: '0'.repeat(64), contentType: 'image/png' },
};

/** Every display state, then the rest of a long list, so the probes cover wrapping into columns and "more". */
const ROWS: DataRow[] = [
  { label: 'Criterio de ejemplo 1', rating: 'meets', ratingLabel: 'Cumple' },
  {
    label: 'Criterio de ejemplo 2 con un título corto largo',
    rating: 'partially_meets',
    ratingLabel: 'Cumple parcialmente',
  },
  { label: 'Criterio de ejemplo 3', rating: 'does_not_meet', ratingLabel: 'No cumple' },
  { label: 'Criterio de ejemplo 4', rating: 'not_mentioned', ratingLabel: 'No lo menciona' },
  { label: 'Criterio de ejemplo 5', rating: 'pending', ratingLabel: 'Pendiente de evaluar' },
  { label: 'Criterio de ejemplo 6', rating: 'withdrawn', ratingLabel: 'Valoración retirada' },
  ...Array.from({ length: 12 }, (_, i): DataRow => ({
    label: `Criterio de ejemplo ${i + 7}`,
    rating: (['meets', 'does_not_meet', 'pending'] as const)[i % 3] ?? 'pending',
    ratingLabel: ['Cumple', 'No cumple', 'Pendiente de evaluar'][i % 3] ?? '',
  })),
];
const LEGEND = ROWS.slice(0, 5).map(({ rating, ratingLabel }) => ({ rating, label: ratingLabel }));
const MORE = 'y # más en la web';

/** The data cards' frame (PLAN R185): the data's date instead of "updated". */
const DATA: DataFrame = { ...FRAME, updated: undefined, dataDate: 'Datos del 1 de enero' };
const QUESTION = '¿Cumplen los partidos de ejemplo las demandas de Organización de ejemplo A?';
/** Five fictional parties: logo and colour, neither, colour only, logo only, colour only. */
const PARTIES: CardParty[] = [
  { short: 'PEA', name: 'Partido Ejemplo A', colour: '#6a4c93' },
  { short: 'PEB', name: 'Partido Ejemplo B', colour: null },
  { short: 'PEC', name: 'Partido Ejemplo C', colour: '#1982c4' },
  { short: 'Ejemplo D', name: 'Partido Ejemplo D', colour: null },
  { short: 'PEE', name: 'Partido Ejemplo E con un nombre largo', colour: '#f4a261' },
];
const PARTY_LOGOS = [
  { sha256: '1'.repeat(64), contentType: 'image/png' },
  null,
  null,
  { sha256: '2'.repeat(64), contentType: 'image/png' },
  null,
];
const PARTY_LOGO_IMAGES = [probeLogo(), undefined, undefined, probeSquareLogo(), undefined];
const CRITERIA = [
  'Ejemplo 1',
  'Ejemplo 2 con un título corto',
  'Ejemplo 3',
  'Ejemplo 4',
  'Ejemplo 5',
  'Ejemplo 6',
];
const DISPLAYS: RatingDisplay[] = [
  'meets',
  'partially_meets',
  'does_not_meet',
  'not_mentioned',
  'pending',
];
const DISPLAY_LABELS = [
  'Cumple',
  'Cumple parcialmente',
  'No cumple',
  'No lo menciona',
  'Pendiente de evaluar',
];
/** Every display state, a withdrawn rating among them. */
const GRID: RatingDisplay[][] = [
  ['meets', 'meets', 'partially_meets', 'meets', 'not_mentioned', 'partially_meets'],
  ['partially_meets', 'does_not_meet', 'not_mentioned', 'partially_meets', 'withdrawn', 'meets'],
  [
    'does_not_meet',
    'not_mentioned',
    'not_mentioned',
    'does_not_meet',
    'partially_meets',
    'not_mentioned',
  ],
  ['meets', 'partially_meets', 'meets', 'meets', 'meets', 'partially_meets'],
  ['pending', 'partially_meets', 'does_not_meet', 'not_mentioned', 'pending', 'does_not_meet'],
];
const WORDS: Record<RatingDisplay, string> = {
  meets: 'Cumple',
  partially_meets: 'Cumple parcialmente',
  does_not_meet: 'No cumple',
  not_mentioned: 'No lo menciona',
  pending: 'Pendiente de evaluar',
  withdrawn: 'Valoración retirada',
} as Record<RatingDisplay, string>;
const labelled = (grid: RatingDisplay[][]) =>
  grid.map((row) => row.map((rating) => ({ rating, label: WORDS[rating] ?? '' })));
const MANY_PARTIES: CardParty[] = Array.from({ length: 20 }, (_, i) => ({
  short: `PE${String.fromCharCode(65 + i)}`,
  name: `Partido Ejemplo ${String.fromCharCode(65 + i)}`,
  colour: i % 3 === 0 ? '#6a4c93' : null,
}));
const MANY_CRITERIA = Array.from({ length: 12 }, (_, i) => `Ejemplo ${i + 1}`);

export const PROBES: Readonly<Record<TemplateName, readonly Probe[]>> = {
  overview: [
    {
      // The scorecard's link preview (PLAN R185, canvas A): five parties, six criteria, every display state; logos and
      // colours in every combination.
      id: 'grid',
      node: (size) =>
        overviewCard(
          {
            ...DATA,
            ...WITH_LOGO,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · 6 criterios, con sus fuentes',
            parties: PARTIES,
            partyLogos: PARTY_LOGOS,
            criteria: CRITERIA,
            cells: GRID,
            legend: LEGEND,
            more: MORE,
          },
          size,
          { operatorLogo: probeLogo(), partyLogos: PARTY_LOGO_IMAGES },
        ),
    },
    {
      // Three parties with neither logo nor colour: no marks at all.
      id: 'plain',
      node: (size) =>
        overviewCard(
          {
            ...DATA,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · 4 criterios, con sus fuentes',
            parties: PARTIES.slice(0, 4)
              .map((party) => ({ ...party, colour: null }))
              .slice(0, 3),
            criteria: CRITERIA.slice(0, 4),
            cells: GRID.slice(0, 3).map((row) => row.slice(0, 4)),
            legend: LEGEND,
            more: MORE,
          },
          size,
        ),
    },
    {
      // A site's own accent (PLAN R178), dark, so its texts turn to paper.
      id: 'colours',
      node: (size) =>
        overviewCard(
          {
            ...DATA,
            theme: cardTheme({ accent: '#1d3557' }),
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · 6 criterios, con sus fuentes',
            parties: PARTIES,
            criteria: CRITERIA,
            cells: GRID,
            legend: LEGEND,
            more: MORE,
            dataDate: 'Aún sin valoraciones publicadas',
          },
          size,
        ),
    },
    {
      // A crowded election: more parties than fit ("and # more"), criteria numbered and keyed below.
      id: 'many',
      node: (size) =>
        overviewCard(
          {
            ...DATA,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · 12 criterios, con sus fuentes',
            parties: MANY_PARTIES,
            criteria: MANY_CRITERIA,
            cells: MANY_PARTIES.map((_, i) =>
              MANY_CRITERIA.map((__, j) => DISPLAYS[(i + j) % 5] ?? 'pending'),
            ),
            legend: LEGEND,
            more: MORE,
          },
          size,
        ),
    },
  ],
  party: [
    {
      id: 'few',
      node: (size) =>
        partyCard(
          {
            ...DATA,
            question: '¿Cumple las demandas de Organización de ejemplo A?',
            party: { short: 'PEA', name: 'Partido Ejemplo A', colour: null },
            rows: ROWS.slice(0, 4),
            more: MORE,
          },
          size,
        ),
    },
    {
      // A long name, a logo and a colour, and more criteria than fit.
      id: 'many-logos',
      node: (size) =>
        partyCard(
          {
            ...DATA,
            ...WITH_LOGO,
            question: '¿Cumple las demandas de Organización de ejemplo A?',
            party: {
              short: 'PEB',
              name: 'Partido Ejemplo B por la Representación de los Nombres Largos',
              colour: '#6a4c93',
            },
            partyLogo: { sha256: '1'.repeat(64), contentType: 'image/png' },
            rows: ROWS,
            more: MORE,
          },
          size,
          { operatorLogo: probeLogo(), partyLogo: probeSquareLogo() },
        ),
    },
    {
      // A colour and no logo: the rounded square beside the name.
      id: 'colour',
      node: (size) =>
        partyCard(
          {
            ...DATA,
            question: '¿Cumple las demandas de Organización de ejemplo A?',
            party: { short: 'PEC', name: 'Partido Ejemplo C', colour: '#1982c4' },
            rows: ROWS.slice(0, 6),
            more: MORE,
          },
          size,
        ),
    },
  ],
  criterion: [
    {
      id: 'parties',
      node: (size) =>
        criterionCard(
          {
            ...DATA,
            kicker: 'Criterio 1 de 6',
            title: 'Criterio de ejemplo 1: una pausa de ejemplo',
            rows: PARTIES.slice(0, 3).map((party, i) => ({
              ...(ROWS[i] as DataRow),
              label: party.short,
              party: { ...party, colour: null },
            })),
            more: MORE,
          },
          size,
        ),
    },
    {
      // Each party's mark (PLAN R184): logos and colours in every combination, and the criterion's description.
      id: 'marks',
      node: (size) =>
        criterionCard(
          {
            ...DATA,
            ...WITH_LOGO,
            kicker: 'Criterio 3 de 6',
            title: 'Criterio de ejemplo 3',
            description:
              'Descripción de ejemplo del criterio, tal como la escribe la metodología, con una segunda frase ' +
              'inventada para ver cómo se corta cuando no cabe.',
            rows: PARTIES.map((party, i) => ({
              ...(ROWS[i] as DataRow),
              label: party.short,
              party,
            })),
            partyLogos: PARTY_LOGOS,
            more: MORE,
          },
          size,
          { operatorLogo: probeLogo(), partyLogos: PARTY_LOGO_IMAGES },
        ),
    },
    {
      // More parties than fit.
      id: 'many',
      node: (size) =>
        criterionCard(
          {
            ...DATA,
            kicker: 'Criterio 2 de 12',
            title: 'Criterio de ejemplo 2 con un título largo para ver cómo se parte en dos líneas',
            rows: MANY_PARTIES.map((party, i) => ({
              label: party.short,
              rating: DISPLAYS[i % 5] ?? 'pending',
              ratingLabel: DISPLAY_LABELS[i % 5] ?? '',
              party,
            })),
            more: MORE,
          },
          size,
        ),
    },
  ],
  cell: [
    {
      id: 'rated',
      node: (size) =>
        cellCard(
          {
            ...FRAME,
            party: 'Partido Ejemplo A',
            criterion: 'Criterio de ejemplo 2 con un título largo para ver cómo se parte',
            rating: 'partially_meets',
            ratingLabel: 'Cumple parcialmente',
            summary:
              'Un resumen inventado de la valoración: el programa de ejemplo propone una medida parecida, sin plazos ' +
              'ni detalle, y no dice quién la aplicaría ni cómo se comprobaría que se cumple.',
            source: 'Fuente: Programa de ejemplo del Partido Ejemplo A',
          },
          size,
        ),
    },
    {
      id: 'pending-logos',
      node: (size) =>
        cellCard(
          {
            ...FRAME,
            ...WITH_LOGO,
            updated: undefined,
            party: 'Partido Ejemplo B',
            partyLogo: { sha256: '1'.repeat(64), contentType: 'image/png' },
            partyColour: '#1982c4',
            criterion: 'Criterio de ejemplo 3',
            rating: 'pending',
            ratingLabel: 'Pendiente de evaluar',
          },
          size,
          { operatorLogo: probeLogo(), partyLogo: probeLogo() },
        ),
    },
  ],
  methodology: [
    {
      id: 'legend',
      node: (size) =>
        methodologyCard(
          {
            ...FRAME,
            updated: undefined,
            kicker: 'Metodología',
            title: 'Cómo valoramos si los partidos de ejemplo cumplen las demandas',
            legend: LEGEND,
          },
          size,
        ),
    },
  ],
  corrections: [
    {
      id: 'summary',
      node: (size) =>
        correctionsCard(
          {
            ...FRAME,
            kicker: 'Registro de correcciones',
            title: 'Elecciones de ejemplo',
            summary: '3 cambios publicados, cada uno con su nota; el último, el 1 de enero.',
          },
          size,
        ),
    },
  ],
  table: [
    {
      id: 'small',
      node: (size) =>
        tableCard(
          {
            ...DATA,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · cada valoración, con sus citas en la web',
            parties: PARTIES.slice(0, 3).map((party) => ({ ...party, colour: null })),
            criteria: CRITERIA.slice(0, 4),
            cells: labelled(GRID.slice(0, 3).map((row) => row.slice(0, 4))),
            legend: LEGEND,
          },
          size,
        ),
    },
    {
      // The parties' marks (PLAN R184): logos and colours in every combination; the names stay lined up.
      id: 'marks',
      node: (size) =>
        tableCard(
          {
            ...DATA,
            ...WITH_LOGO,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · cada valoración, con sus citas en la web',
            parties: PARTIES,
            partyLogos: PARTY_LOGOS,
            criteria: CRITERIA,
            cells: labelled(GRID),
            legend: LEGEND,
          },
          size,
          { operatorLogo: probeLogo(), partyLogos: PARTY_LOGO_IMAGES },
        ),
    },
    {
      // A site's own accent, dark.
      id: 'colours',
      node: (size) =>
        tableCard(
          {
            ...DATA,
            theme: cardTheme({ accent: '#1d3557' }),
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · cada valoración, con sus citas en la web',
            parties: PARTIES,
            criteria: CRITERIA,
            cells: labelled(GRID),
            legend: LEGEND,
          },
          size,
        ),
    },
    {
      // The demo's shape (PLAN R216): eleven parties and ten criteria, where the words no longer fit whole under
      // their icons, so the legend gives them; never cut.
      id: 'eleven',
      node: (size) =>
        tableCard(
          {
            ...DATA,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · cada valoración, con sus citas en la web',
            parties: MANY_PARTIES.slice(0, 11),
            criteria: MANY_CRITERIA.slice(0, 10),
            cells: labelled(
              MANY_PARTIES.slice(0, 11).map((_, i) =>
                MANY_CRITERIA.slice(0, 10).map((__, j) => DISPLAYS[(i + j) % 5] ?? 'pending'),
              ),
            ),
            legend: LEGEND,
          },
          size,
        ),
    },
    {
      // A crowded election: twenty parties and twelve criteria, numbered and keyed below.
      id: 'large',
      node: (size) =>
        tableCard(
          {
            ...DATA,
            title: QUESTION,
            subtitle: 'Elecciones de ejemplo · cada valoración, con sus citas en la web',
            parties: MANY_PARTIES,
            criteria: MANY_CRITERIA,
            cells: labelled(
              MANY_PARTIES.map((_, i) =>
                MANY_CRITERIA.map((__, j) => DISPLAYS[(i + j) % 5] ?? 'pending'),
              ),
            ),
            legend: LEGEND,
          },
          size,
        ),
    },
  ],
  'coming-soon': [
    { id: 'words', node: (size) => comingSoonCard(COMING_SOON, size) },
    {
      id: 'logo',
      node: (size) =>
        comingSoonCard(
          {
            ...COMING_SOON,
            name: 'Ejemplo',
            operatorLogo: { sha256: '0'.repeat(64), contentType: 'image/png' },
          },
          size,
          { operatorLogo: probeLogo() },
        ),
    },
  ],
};
