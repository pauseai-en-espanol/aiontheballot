import { describe, expect, it } from 'vitest';

import { electionEntries, renderSitemap } from './sitemap';

describe('renderSitemap', () => {
  it('lists every page in each language, with its alternates, on the canonical base', () => {
    const xml = renderSitemap(
      'https://ejemplo-a.test',
      'es',
      ['es', 'en'],
      [
        { target: { page: 'home' } },
        { target: { page: 'legalNotice' }, lastModified: '2030-01-15T10:00:00.000Z' },
      ],
    );
    expect(xml).toContain('<loc>https://ejemplo-a.test</loc>');
    expect(xml).toContain('<loc>https://ejemplo-a.test/en</loc>');
    expect(xml).toContain('<loc>https://ejemplo-a.test/aviso-legal</loc>');
    expect(xml).toContain('<loc>https://ejemplo-a.test/en/aviso-legal</loc>');
    expect(xml).toContain('<lastmod>2030-01-15T10:00:00.000Z</lastmod>');
    expect(xml).toContain('hreflang="x-default" href="https://ejemplo-a.test/aviso-legal"');
    expect(xml.match(/<url>/g)).toHaveLength(4);
  });
});

describe('electionEntries', () => {
  it('names the scorecard, the methodology and every party, criterion and cell, each with its latest change', () => {
    const entries = electionEntries({
      election: { slug: 'e', name: { es: 'E' }, date: null, status: 'live' },
      methodology: null,
      parties: [
        {
          id: 'p',
          slug: 'p',
          name: {},
          shortName: {},
          colour: null,
          website: null,
          programmeStatus: 'pending',
          programmeCheckedAt: null,
        },
      ],
      criteria: [{ id: 'c', slug: 'c', title: {}, shortTitle: null, description: {} }],
      cells: [
        {
          partyId: 'p',
          criterionId: 'c',
          revisions: [
            {
              revisionNo: 1,
              rating: 'meets',
              summary: null,
              changeKind: 'initial',
              publicNote: null,
              publishedAt: '2030-01-15T10:00:00.000Z',
              evidence: [],
              checkedDocuments: [],
            },
          ],
        },
      ],
    });
    expect(entries.map((entry) => entry.target.page)).toEqual([
      'election',
      'methodology',
      'party',
      'criterion',
      'cell',
    ]);
    expect(entries.find((entry) => entry.target.page === 'cell')?.lastModified).toBe(
      '2030-01-15T10:00:00.000Z',
    );
  });
});
