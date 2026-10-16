import { describe, expect, it } from 'vitest';

import { slugFrom } from './slug';

describe('a slug made from a name (admin forms §1.5, PLAN R192)', () => {
  it('keeps letters and digits, without accents or case, joined by single hyphens', () => {
    expect(slugFrom('Partido Ejemplo A')).toBe('partido-ejemplo-a');
    expect(slugFrom('  Elecciones   Autonómicas: Ñandú 2027! ')).toBe(
      'elecciones-autonomicas-nandu-2027',
    );
    expect(slugFrom('—')).toBe('');
  });

  it('stops at 63 characters, never on a hyphen', () => {
    const long = slugFrom(`${'palabra '.repeat(12)}final`);
    expect(long.length).toBeLessThanOrEqual(63);
    expect(long.endsWith('-')).toBe(false);
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(long)).toBe(true);
  });
});
