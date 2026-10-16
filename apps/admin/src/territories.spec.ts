import { iso31661 } from 'iso-3166';
import { describe, expect, it } from 'vitest';

import { territoriesOf } from './territories';

// The shape the database checks a territory code against (`elections.territory_code`, `parties.territory_codes`).
const STORED = /^[A-Z]{2}-[A-Z0-9]{1,3}$/u;

describe('territoriesOf (PLAN R201)', () => {
  it('lists none for a code ISO keeps for private use, such as a demo or test site has', () => {
    expect(territoriesOf('XA')).toEqual([]);
    expect(territoriesOf('XE')).toEqual([]);
  });

  it('lists, for every country, only codes of its own the database takes, each inside it or one it lists', () => {
    let listed = 0;
    for (const { alpha2 } of iso31661) {
      const territories = territoriesOf(alpha2);
      const codes = new Set(territories.map((t) => t.code));
      for (const territory of territories) {
        expect(territory.code).toMatch(STORED);
        expect(territory.code.startsWith(`${alpha2}-`)).toBe(true);
        expect(territory.parent === null || codes.has(territory.parent)).toBe(true);
        expect(territory.name.trim()).not.toBe('');
      }
      listed += territories.length;
    }
    // The pinned package's list, which a new version changes only on purpose.
    expect(listed).toBeGreaterThan(4_000);
  });
});
