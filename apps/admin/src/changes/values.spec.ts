import { describe, expect, it } from 'vitest';

import { changedValues, fieldChanges, sameValue } from './values';

const PARTY = {
  name: 'localized',
  short_name: 'localized',
  logo_file_id: 'logo',
  colour: 'colour',
  website: 'url',
  territory_codes: 'codes',
  display_order: 'number',
} as const;

const NOW = {
  name: { es: 'Partido Ejemplo A' },
  short_name: { es: 'PEA' },
  logo_file_id: null,
  colour: '#1a6b3c',
  website: null,
  territory_codes: ['XE-AN'],
  display_order: 1,
};

describe("a change request's values (PLAN R183)", () => {
  it('count as the same when only what is never stored differs', () => {
    expect(sameValue('localized', { es: 'PEA' }, { es: ' PEA ', en: '' })).toBe(true);
    expect(sameValue('colour', '#1A6B3C', '#1a6b3c')).toBe(true);
    expect(sameValue('url', null, '')).toBe(true);
    expect(sameValue('codes', ['XE-AN'], 'xe-an, XE-AN')).toBe(true);
    expect(sameValue('number', 1, '1')).toBe(true);
    expect(sameValue('sourceKinds', ['pdf', 'video'], ['video', 'pdf'])).toBe(true);
  });

  it('send only the fields that differ, as they will be stored', () => {
    expect(
      changedValues(PARTY, NOW, {
        name: { es: 'Partido Ejemplo A', en: '' },
        short_name: { es: 'PE-A', en: 'EP-A' },
        colour: '#1A6B3C',
        website: 'https://partido.example',
        territory_codes: null,
        display_order: 1,
      }),
    ).toEqual({
      short_name: { en: 'EP-A', es: 'PE-A' },
      website: 'https://partido.example',
      territory_codes: null,
    });
  });

  it('send a colour taken away as none, and nothing at all when nothing changed', () => {
    expect(changedValues(PARTY, NOW, { colour: null })).toEqual({ colour: null });
    expect(changedValues(PARTY, NOW, { ...NOW })).toEqual({});
  });

  it("list a set's fields in the forms' order, each with its value before, and one field as itself", () => {
    expect(
      fieldChanges(
        null,
        { website: null, colour: '#111111', name: { es: 'A' } },
        { website: 'https://partido.example', colour: '#222222', name: { es: 'B' } },
      ),
    ).toEqual([
      { field: 'name', before: { es: 'A' }, after: { es: 'B' } },
      { field: 'colour', before: '#111111', after: '#222222' },
      { field: 'website', before: null, after: 'https://partido.example' },
    ]);
    expect(fieldChanges('colour', '#111111', '#222222')).toEqual([
      { field: 'colour', before: '#111111', after: '#222222' },
    ]);
    expect(fieldChanges(null, null, null)).toEqual([]);
  });
});
