import type { PublicElection, PublicRevision } from '@aiontheballot/domain/public-election';

import { describe, expect, it } from 'vitest';

import { correctionsLog, fieldChanges, showsValues } from './corrections-log';

const revision = (
  revisionNo: number,
  changeKind: PublicRevision['changeKind'],
  publishedAt: string,
  rating: PublicRevision['rating'] = 'meets',
): PublicRevision => ({
  revisionNo,
  rating,
  summary: null,
  changeKind,
  publicNote: changeKind === 'initial' ? null : { es: `Nota de la revisión ${revisionNo}.` },
  publishedAt,
  evidence: [],
  checkedDocuments: [],
});

const party = (id: string) => ({
  id,
  slug: `partido-${id}`,
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
  slug: 'criterio',
  title: { es: 'Criterio de ejemplo' },
  shortTitle: null,
  description: { es: 'x' },
};

const election = (changes?: PublicElection['changes']): PublicElection => ({
  election: { slug: 'generales', name: { es: 'Generales de ejemplo' }, date: null, status: 'live' },
  methodology: null,
  parties: [party('A')],
  criteria: [criterion],
  cells: [
    {
      partyId: 'A',
      criterionId: 'c',
      revisions: [
        revision(3, 'withdrawal', '2030-01-05T10:00:00Z', null),
        revision(2, 'correction', '2030-01-03T10:00:00Z', 'does_not_meet'),
        revision(1, 'initial', '2030-01-01T10:00:00Z'),
      ],
    },
    // A retired party's cell: not this election's any more.
    {
      partyId: 'gone',
      criterionId: 'c',
      revisions: [revision(2, 'update', '2030-01-06T10:00:00Z')],
    },
  ],
  ...(changes ? { changes } : {}),
});

describe('the corrections log (R150)', () => {
  it("lists cells' later revisions and the structure's changes, newest first, never a first rating", () => {
    const log = correctionsLog(
      election([
        {
          action: 'update',
          targetKind: 'party',
          target: { es: 'Partido Ejemplo A' },
          field: 'website',
          previousValue: null,
          newValue: 'https://ejemplo.test',
          publicNote: { es: 'Una nota pública inventada.' },
          approvedAt: '2030-01-04T10:00:00Z',
        },
      ]),
    );
    expect(log.map((entry) => [entry.kind, entry.at])).toEqual([
      ['revision', '2030-01-05T10:00:00Z'],
      ['structure', '2030-01-04T10:00:00Z'],
      ['revision', '2030-01-03T10:00:00Z'],
    ]);
    expect(log[0]).toMatchObject({ change: 'withdrawal', rating: null, revisionNo: 3 });
    expect(log[2]).toMatchObject({
      change: 'correction',
      rating: 'does_not_meet',
      note: { es: 'Nota de la revisión 2.' },
    });
  });

  it("reads an older API's answer, without structural changes, as having none", () => {
    expect(correctionsLog(election()).every((entry) => entry.kind === 'revision')).toBe(true);
  });
});

describe('what the log shows of a structural change (R150)', () => {
  const change = (fields: Partial<Parameters<typeof showsValues>[0]>) => ({
    action: 'update' as const,
    targetKind: 'party' as const,
    target: { es: 'Partido Ejemplo A' },
    field: 'website',
    previousValue: null,
    newValue: 'https://ejemplo.test',
    publicNote: { es: 'Nota.' },
    approvedAt: '2030-01-01T10:00:00Z',
    ...fields,
  });

  it("shows a short field's before and after, and only that a long text, an id or an order changed", () => {
    expect(showsValues(change({}))).toBe(true);
    expect(showsValues(change({ field: 'name' }))).toBe(true);
    for (const field of [
      'body',
      'description',
      'display_order',
      'logo_file_id',
      'demands_owner_id',
    ]) {
      expect(showsValues(change({ field })), field).toBe(false);
    }
    expect(showsValues(change({ action: 'add', field: null }))).toBe(false);
  });

  it("never shows an external reviewer's names: personal data (R26)", () => {
    expect(showsValues(change({ targetKind: 'methodology_reviewer', field: 'name' }))).toBe(false);
    expect(showsValues(change({ targetKind: 'methodology_reviewer', field: 'affiliation' }))).toBe(
      false,
    );
  });

  it("lists each field of a set (PLAN R183) in the forms' order, with the short ones' values", () => {
    const set = change({
      field: null,
      fields: ['website', 'colour', 'logo_file_id', 'short_name'],
      previousValue: {
        website: null,
        colour: '#111111',
        logo_file_id: null,
        short_name: { es: 'PEA' },
      },
      newValue: {
        website: 'https://ejemplo.test',
        colour: '#222222',
        logo_file_id: '00000000-0000-4000-8000-000000000001',
        short_name: { es: 'PE-A' },
      },
    });
    expect(showsValues(set)).toBe(false);
    expect(fieldChanges(set)).toEqual([
      { field: 'short_name', before: { es: 'PEA' }, after: { es: 'PE-A' }, shown: true },
      {
        field: 'logo_file_id',
        before: null,
        after: '00000000-0000-4000-8000-000000000001',
        shown: false,
      },
      { field: 'colour', before: '#111111', after: '#222222', shown: true },
      { field: 'website', before: null, after: 'https://ejemplo.test', shown: true },
    ]);
  });

  it("names an external reviewer's changed fields, never their values (R26)", () => {
    const set = change({
      targetKind: 'methodology_reviewer',
      field: null,
      fields: ['affiliation', 'name'],
      previousValue: null,
      newValue: null,
    });
    expect(fieldChanges(set).map(({ field, shown }) => [field, shown])).toEqual([
      ['name', false],
      ['affiliation', false],
    ]);
  });

  it('keeps one field as one change, and lists none for an addition or a retirement', () => {
    expect(fieldChanges(change({}))).toEqual([
      { field: 'website', before: null, after: 'https://ejemplo.test', shown: true },
    ]);
    expect(fieldChanges(change({ action: 'retire', field: null }))).toEqual([]);
  });
});
