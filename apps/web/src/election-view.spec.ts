import type {
  PublicElection,
  PublicMethodology,
  PublicRevision,
} from '@aiontheballot/domain/public-election';

import { describe, expect, it } from 'vitest';

import { cellViews, lastChange, methodologyOf } from './election-view';

const revision = (
  revisionNo: number,
  rating: PublicRevision['rating'],
  publishedAt: string,
): PublicRevision => ({
  revisionNo,
  rating,
  summary: null,
  changeKind: revisionNo === 1 ? 'initial' : rating === null ? 'withdrawal' : 'update',
  publicNote: null,
  publishedAt,
  evidence: [],
  checkedDocuments: [],
});

const party = (id: string) => ({
  id,
  slug: `partido-ejemplo-${id}`,
  name: { es: `Partido Ejemplo ${id}` },
  shortName: { es: `PE${id}` },
  colour: null,
  website: null,
  programmeStatus: 'pending' as const,
  programmeCheckedAt: null,
  logo: null,
});

const criterion = {
  id: 'c',
  slug: 'criterio-de-ejemplo',
  title: { es: 'Criterio de ejemplo' },
  shortTitle: null,
  description: { es: 'Un criterio inventado.' },
};

const election = (
  cells: PublicElection['cells'],
  methodology: PublicMethodology | null = null,
): PublicElection => ({
  election: { slug: 'generales', name: { es: 'Generales de ejemplo' }, date: null, status: 'live' },
  methodology,
  parties: [party('A'), party('B'), party('C')],
  criteria: [criterion],
  cells,
});

describe("a cell's view", () => {
  const data = election([
    {
      partyId: 'B',
      criterionId: 'c',
      revisions: [
        revision(2, 'meets', '2030-01-02T10:00:00Z'),
        revision(1, 'partially_meets', '2030-01-01T10:00:00Z'),
      ],
    },
    {
      partyId: 'C',
      criterionId: 'c',
      revisions: [
        revision(2, null, '2030-01-03T10:00:00Z'),
        revision(1, 'meets', '2030-01-01T09:00:00Z'),
      ],
    },
  ]);
  const cell = cellViews(data);

  it('is pending without a published revision', () => {
    expect(cell(party('A'), criterion)).toMatchObject({
      display: 'pending',
      current: undefined,
      history: [],
    });
  });

  it('shows the newest revision, with every one in its history', () => {
    const view = cell(party('B'), criterion);
    expect(view.display).toBe('meets');
    expect(view.current?.revisionNo).toBe(2);
    expect(view.history.map((r) => r.revisionNo)).toEqual([2, 1]);
  });

  it('is withdrawn when the newest revision holds no rating, and shows no earlier one as current', () => {
    const view = cell(party('C'), criterion);
    expect(view.display).toBe('withdrawn');
    expect(view.current).toBeUndefined();
    expect(view.history).toHaveLength(2);
  });

  it("dates the election's latest change by its newest revision", () => {
    expect(lastChange(data)).toBe('2030-01-03T10:00:00Z');
    expect(lastChange(election([]))).toBeUndefined();
  });
});

describe("the ratings' wording", () => {
  const owner = { name: { es: 'Organización de ejemplo' }, url: null };
  const methodology = (
    kind: PublicMethodology['kind'],
    demandsOwner: PublicMethodology['demandsOwner'],
  ): PublicMethodology => ({ kind, demandsOwner, body: { es: 'Texto.' }, reviewers: [] });

  it("follows the election's methodology, else the site's", () => {
    expect(methodologyOf(election([], methodology('demands', owner)), 'descriptive')).toEqual({
      kind: 'demands',
      owner,
    });
    expect(methodologyOf(election([]), 'descriptive')).toEqual({
      kind: 'descriptive',
      owner: null,
    });
  });

  it("stays a demands scale when the demands' owner isn't public", () => {
    expect(methodologyOf(election([], methodology('demands', null)), 'descriptive')).toEqual({
      kind: 'demands',
      owner: null,
    });
  });
});
