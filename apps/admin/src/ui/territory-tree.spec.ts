import { describe, expect, it } from 'vitest';

import { findTerritories, type Territory, territoryGroups } from './territory-tree';

// A fictional country, XE, two levels deep in one place and three in another.
const TERRITORIES: Territory[] = [
  { code: 'XE-N', name: 'Norte de Ejemplo', parent: null },
  { code: 'XE-S', name: 'Éjemplo Sur', parent: null },
  { code: 'XE-NB', name: 'Bahía', parent: 'XE-N' },
  { code: 'XE-NA', name: 'Alto', parent: 'XE-N' },
  { code: 'XE-NAC', name: 'Cumbre', parent: 'XE-NA' },
  { code: 'XE-Z', name: 'Zona suelta', parent: 'XE-Q' },
];

describe('territoryGroups (PLAN R201)', () => {
  it('lists those directly under the country by name, each with every one inside it, at any depth, by name', () => {
    expect(
      territoryGroups(TERRITORIES, 'es').map(({ top, within }) => [
        top.code,
        within.map((t) => t.code),
      ]),
    ).toEqual([
      ['XE-S', []],
      ['XE-N', ['XE-NA', 'XE-NB', 'XE-NAC']],
      ['XE-Z', []],
    ]);
  });

  it("keeps one whose parent isn't listed, on its own, and is empty for a country with none", () => {
    expect(territoryGroups(TERRITORIES, 'es').some(({ top }) => top.code === 'XE-Z')).toBe(true);
    expect(territoryGroups([], 'es')).toEqual([]);
  });

  it('never loops on a parent that leads back to itself', () => {
    const looped: Territory[] = [
      { code: 'XE-A', name: 'A', parent: 'XE-B' },
      { code: 'XE-B', name: 'B', parent: 'XE-A' },
    ];
    expect(
      territoryGroups(looped, 'es').flatMap(({ top, within }) => [top, ...within]),
    ).toHaveLength(2);
  });
});

describe('findTerritories (PLAN R201)', () => {
  it('finds by name or code, whatever the case and accents, by name', () => {
    expect(findTerritories(TERRITORIES, 'EJEMPLO', 'es').map((t) => t.code)).toEqual([
      'XE-S',
      'XE-N',
    ]);
    expect(findTerritories(TERRITORIES, 'bahia', 'es').map((t) => t.code)).toEqual(['XE-NB']);
    expect(findTerritories(TERRITORIES, 'xe-nac', 'es').map((t) => t.code)).toEqual(['XE-NAC']);
  });

  it('finds every one for nothing typed, and none for what matches nothing', () => {
    expect(findTerritories(TERRITORIES, '  ', 'es')).toHaveLength(TERRITORIES.length);
    expect(findTerritories(TERRITORIES, 'ninguno', 'es')).toEqual([]);
  });
});
