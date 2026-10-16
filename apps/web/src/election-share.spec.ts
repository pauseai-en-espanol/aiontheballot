import type { PublicElection, PublicRevision } from '@aiontheballot/domain/public-election';
import type { PublicHome } from '@aiontheballot/domain/public-home';

import { describe, expect, it } from 'vitest';

import {
  electionCard,
  electionCardHash,
  electionImagePath,
  type ElectionShareData,
  type ElectionView,
  electionViews,
  parseElectionImagePath,
} from './election-share';

const home: PublicHome = {
  tenant: {
    displayName: { es: 'Inquilino de ejemplo', en: 'Example tenant' },
    defaultLocale: 'es',
    countryCode: 'XA',
    methodologyKind: 'demands',
  },
  operator: {
    displayName: { es: 'Organización de ejemplo' },
    url: null,
    contactEmail: null,
    newsletterUrl: null,
    legalName: 'Organización de Ejemplo',
    taxId: null,
    address: null,
    registryEntry: null,
    privacyEmail: null,
  },
  documents: {},
  elections: [],
  signups: false,
  election: null,
  brand: {},
};

const revision = (rating: PublicRevision['rating'], publishedAt: string): PublicRevision => ({
  revisionNo: 1,
  rating,
  summary: { es: 'Un resumen inventado.' },
  changeKind: 'initial',
  publicNote: null,
  publishedAt,
  evidence: [
    {
      quote: 'Una cita inventada de un programa de ejemplo.',
      locationLabel: 'p. 1',
      source: {
        title: 'Programa de ejemplo A',
        language: 'es',
        url: null,
        kind: 'pdf',
        sha256: null,
        retrievedAt: null,
        archiveUrl: null,
      },
    },
  ],
  checkedDocuments: [],
});

const party = (id: string) => ({
  id,
  slug: `partido-ejemplo-${id.toLowerCase()}`,
  name: { es: `Partido Ejemplo ${id}` },
  shortName: { es: `PE${id}` },
  colour: null,
  website: null,
  programmeStatus: 'pending' as const,
  programmeCheckedAt: null,
  logo: id === 'A' ? { sha256: 'a'.repeat(64), contentType: 'image/png' } : null,
});

const criterion = (id: string) => ({
  id,
  slug: `criterio-${id}`,
  title: { es: `Criterio de ejemplo ${id}` },
  shortTitle: { es: `Criterio ${id}` },
  description: { es: 'Un criterio inventado.' },
});

const election: PublicElection = {
  election: {
    slug: 'generales',
    name: { es: 'Generales de ejemplo' },
    date: '2030-01-15',
    status: 'live',
  },
  methodology: null,
  parties: [party('A'), party('B')],
  criteria: [criterion('1'), criterion('2')],
  cells: [
    { partyId: 'A', criterionId: '1', revisions: [revision('meets', '2030-01-02T10:00:00Z')] },
  ],
};

const data: ElectionShareData = {
  home,
  base: 'https://ejemplo.example.test',
  locale: 'es',
  election,
};

describe("an election's share images (R148)", () => {
  it('round-trip every view through its path', () => {
    for (const view of electionViews(election)) {
      const path = electionImagePath('generales', view, '1080x1350', '0123456789ab');
      expect(path.startsWith('/generales/og/')).toBe(true);
      const segments = path.slice('/generales/og/'.length).split('/');
      expect(parseElectionImagePath(segments)).toEqual({
        view,
        size: '1080x1350',
        hash: '0123456789ab',
      });
    }
    // Two parties, two criteria: the overview, the methodology, the corrections log, 2 parties, 2 criteria, 4 cells.
    expect(electionViews(election)).toHaveLength(11);
  });

  it('refuse paths that name no view, size or hash', () => {
    for (const segments of [
      [],
      ['overview'],
      ['overview', '1200x630.0123456789ab.jpg'],
      ['overview', '1200x631.0123456789ab.png'],
      ['overview', '1200x630.0123456789AB.png'],
      ['overview', 'extra', '1200x630.0123456789ab.png'],
      ['party', '1200x630.0123456789ab.png'],
      ['party', 'Mayúsculas', '1200x630.0123456789ab.png'],
      ['party', '..', '1200x630.0123456789ab.png'],
      ['cell', 'partido-ejemplo-a', '1200x630.0123456789ab.png'],
      ['home', '1200x630.0123456789ab.png'],
    ]) {
      expect(parseElectionImagePath(segments), segments.join('/')).toBeUndefined();
    }
  });

  it("show a party's rating on each criterion, in words too, with the canonical and methodology addresses", () => {
    const card = electionCard(data, { view: 'party', party: 'partido-ejemplo-a' });
    expect(card?.content.template).toBe('party');
    expect(card?.content.card).toMatchObject({
      site: 'Inquilino de ejemplo',
      address: 'ejemplo.example.test',
      methodology: 'Metodología: ejemplo.example.test/generales/metodologia',
      // Canvas C (PLAN R185): the methodology's question for one party, its names and mark, each criterion by title.
      question: '¿Cumple las demandas que recoge la metodología?',
      party: { short: 'PEA', name: 'Partido Ejemplo A', colour: null },
      rows: [
        { label: 'Criterio de ejemplo 1', rating: 'meets', ratingLabel: 'Cumple' },
        { label: 'Criterio de ejemplo 2', rating: 'pending', ratingLabel: 'Pendiente de evaluar' },
      ],
      partyLogo: { sha256: 'a'.repeat(64), contentType: 'image/png' },
      dataDate: 'Datos del 2 de enero de 2030',
    });
    expect(card?.alt).toBe(
      'Partido Ejemplo A: Criterio de ejemplo 1: Cumple; Criterio de ejemplo 2: Pendiente de evaluar.',
    );
  });

  it("show a cell's rating, summary and source, and say it in words", () => {
    const card = electionCard(data, {
      view: 'cell',
      party: 'partido-ejemplo-a',
      criterion: 'criterio-1',
    });
    expect(card?.content.card).toMatchObject({
      party: 'Partido Ejemplo A',
      criterion: 'Criterio de ejemplo 1',
      rating: 'meets',
      ratingLabel: 'Cumple',
      summary: 'Un resumen inventado.',
      source: 'Fuente: Programa de ejemplo A',
    });
    expect(card?.alt).toBe('Partido Ejemplo A, Criterio de ejemplo 1: Cumple.');
    // A pending cell has no date, summary or source.
    const pending = electionCard(data, {
      view: 'cell',
      party: 'partido-ejemplo-b',
      criterion: 'criterio-2',
    });
    expect(pending?.content.card).not.toHaveProperty('updated');
    expect(pending?.content.card).not.toHaveProperty('summary');
    expect(pending?.content.card).not.toHaveProperty('source');
  });

  it('draw the whole table, parties down the side and criteria across, only in the sizes people post (R162)', () => {
    const card = electionCard(data, { view: 'table' });
    expect(card?.content.template).toBe('table');
    expect(card?.content.card).toMatchObject({
      title: '¿Cumple cada partido las demandas que recoge la metodología?',
      subtitle: 'Generales de ejemplo · cada valoración, con sus citas en la web',
      parties: [
        { short: 'PEA', name: 'Partido Ejemplo A', colour: null },
        { short: 'PEB', name: 'Partido Ejemplo B', colour: null },
      ],
      criteria: ['Criterio 1', 'Criterio 2'],
      // Each rating with its words, which the table writes under its icon.
      cells: [
        [
          { rating: 'meets', label: 'Cumple' },
          { rating: 'pending', label: 'Pendiente de evaluar' },
        ],
        [
          { rating: 'pending', label: 'Pendiente de evaluar' },
          { rating: 'pending', label: 'Pendiente de evaluar' },
        ],
      ],
      address: 'ejemplo.example.test',
      // Each party's logo beside its name, by content hash (R173): B has none.
      partyLogos: [{ sha256: 'a'.repeat(64), contentType: 'image/png' }, null],
      dataDate: 'Datos del 2 de enero de 2030',
    });
    expect(card?.alt).toMatch(/^Inquilino de ejemplo: la tabla entera\. /);
    // Not one of the pages' own views, whose link previews are warmed: it is only downloaded.
    expect(electionViews(election)).not.toContainEqual({ view: 'table' });
    const path = electionImagePath('generales', { view: 'table' }, '1080x1350', '0123456789ab');
    expect(path).toBe('/generales/og/table/1080x1350.0123456789ab.png');
    expect(parseElectionImagePath(['table', '1080x1350.0123456789ab.png'])).toEqual({
      view: { view: 'table' },
      size: '1080x1350',
      hash: '0123456789ab',
    });
    for (const segments of [
      ['table', '1200x630.0123456789ab.png'],
      ['table', 'extra', '1080x1080.0123456789ab.png'],
    ]) {
      expect(parseElectionImagePath(segments), segments.join('/')).toBeUndefined();
    }
  });

  it("show every party's rating on every criterion as the scorecard's link preview, dated, never totalled (R185)", () => {
    const card = electionCard(data, { view: 'overview' });
    expect(card?.content).toEqual({
      template: 'overview',
      card: expect.objectContaining({
        title: '¿Cumple cada partido las demandas que recoge la metodología?',
        subtitle: 'Generales de ejemplo · 2 criterios, con sus fuentes',
        parties: [
          { short: 'PEA', name: 'Partido Ejemplo A', colour: null },
          { short: 'PEB', name: 'Partido Ejemplo B', colour: null },
        ],
        // Each party's logo beside its name, by content hash: B has none.
        partyLogos: [{ sha256: 'a'.repeat(64), contentType: 'image/png' }, null],
        criteria: ['Criterio 1', 'Criterio 2'],
        cells: [
          ['meets', 'pending'],
          ['pending', 'pending'],
        ],
        dataDate: 'Datos del 2 de enero de 2030',
        more: 'y # más en la web',
      }),
    });
    // Parties in the site's order, never ranked or totalled.
    for (const key of ['counts', 'totals', 'rank']) {
      expect(card?.content.card, key).not.toHaveProperty(key);
    }
    // A new rating is a new picture under a new address, dated: a crawler's cached preview says its own date.
    const rerated: PublicElection = {
      ...election,
      cells: [
        {
          partyId: 'A',
          criterionId: '1',
          revisions: [revision('does_not_meet', '2030-01-05T10:00:00Z')],
        },
      ],
    };
    const again = electionCard({ ...data, election: rerated }, { view: 'overview' });
    expect(again?.content.card).toMatchObject({ dataDate: 'Datos del 5 de enero de 2030' });
    expect(electionCardHash(again!.content, '1200x630')).not.toBe(
      electionCardHash(card!.content, '1200x630'),
    );
    // With nothing published yet, it says so.
    const unrated = electionCard(
      { ...data, election: { ...election, cells: [] } },
      { view: 'overview' },
    );
    expect(unrated?.content.card).toMatchObject({ dataDate: 'Aún sin valoraciones publicadas' });
  });

  it("number a criterion among the others and describe it, each party's mark beside its rating (R185)", () => {
    const card = electionCard(data, { view: 'criterion', criterion: 'criterio-2' });
    expect(card?.content.card).toMatchObject({
      kicker: 'Criterio 2 de 2',
      title: 'Criterio de ejemplo 2',
      description: 'Un criterio inventado.',
      rows: [
        { label: 'PEA', party: { short: 'PEA', name: 'Partido Ejemplo A', colour: null } },
        { label: 'PEB', party: { short: 'PEB', name: 'Partido Ejemplo B', colour: null } },
      ],
      partyLogos: [{ sha256: 'a'.repeat(64), contentType: 'image/png' }, null],
      dataDate: 'Aún sin valoraciones publicadas',
    });
  });

  it("draw in the site's own accent and mark the parties with their colours, never the ratings' (R178, R184)", () => {
    const coloured: ElectionShareData = {
      ...data,
      home: { ...home, tenant: { ...home.tenant, theme: { accent: '#1d3557' } } },
      election: {
        ...election,
        parties: [{ ...party('A'), colour: '#6a4c93' }, party('B')],
      },
    };
    const views: ElectionView[] = [
      { view: 'overview' },
      { view: 'table' },
      { view: 'party', party: 'partido-ejemplo-a' },
      { view: 'criterion', criterion: 'criterio-1' },
      { view: 'cell', party: 'partido-ejemplo-a', criterion: 'criterio-1' },
    ];
    const cards = views.map((view) => electionCard(coloured, view)!.content.card);
    for (const card of cards) {
      // Ink would not read on that blue: paper does.
      expect(card.theme).toMatchObject({
        accent: '#1d3557',
        onAccent: '#ffffff',
        canvas: '#FFFFFF',
      });
    }
    const [overview, table, partyCard, criterionCard, cellCard] = cards;
    const marked = [
      { short: 'PEA', name: 'Partido Ejemplo A', colour: '#6a4c93' },
      { short: 'PEB', name: 'Partido Ejemplo B', colour: null },
    ];
    expect(overview).toMatchObject({ parties: marked });
    expect(table).toMatchObject({ parties: marked });
    expect(partyCard).toMatchObject({ party: marked[0] });
    expect(criterionCard).toMatchObject({
      rows: [{ party: marked[0] }, { party: marked[1] }],
    });
    expect(cellCard).toMatchObject({ partyColour: '#6a4c93' });
    // Without colours, none on any card.
    for (const view of views) {
      const card = electionCard(data, view)!.content.card;
      expect(card, view.view).not.toHaveProperty('partyColour');
      expect(JSON.stringify(card), view.view).not.toMatch(/"colour":"#/u);
    }
  });

  it('are in the page’s language, with the address of that language’s pages', () => {
    const card = electionCard({ ...data, locale: 'en' }, { view: 'methodology' });
    expect(card?.content.card).toMatchObject({
      kicker: 'Methodology',
      methodology: 'Methodology: ejemplo.example.test/en/generales/metodologia',
    });
  });

  it('name no view the election lacks', () => {
    const views: ElectionView[] = [
      { view: 'party', party: 'partido-ejemplo-z' },
      { view: 'criterion', criterion: 'criterio-9' },
      { view: 'cell', party: 'partido-ejemplo-a', criterion: 'criterio-9' },
    ];
    for (const view of views) {
      expect(electionCard(data, view)).toBeUndefined();
    }
  });

  it('change hash with what they show, and only then', () => {
    const view: ElectionView = { view: 'criterion', criterion: 'criterio-1' };
    const before = electionCard(data, view);
    const hash = electionCardHash(before!.content, '1200x630');
    expect(electionCardHash(electionCard(data, view)!.content, '1200x630')).toBe(hash);
    expect(electionCardHash(before!.content, '1080x1080')).not.toBe(hash);
    const rerated: PublicElection = {
      ...election,
      cells: [
        {
          partyId: 'A',
          criterionId: '1',
          revisions: [revision('does_not_meet', '2030-01-03T10:00:00Z')],
        },
      ],
    };
    expect(
      electionCardHash(electionCard({ ...data, election: rerated }, view)!.content, '1200x630'),
    ).not.toBe(hash);
    // Another criterion's change leaves this one's card, and its URL, as they were.
    const elsewhere: PublicElection = {
      ...election,
      cells: [
        ...election.cells,
        { partyId: 'B', criterionId: '2', revisions: [revision('meets', '2030-01-04T10:00:00Z')] },
      ],
    };
    expect(
      electionCardHash(electionCard({ ...data, election: elsewhere }, view)!.content, '1200x630'),
    ).toBe(hash);
  });
});
