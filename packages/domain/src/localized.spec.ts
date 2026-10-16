import { describe, expect, it } from 'vitest';

import { isLocalized, pickLocalized } from './localized.js';

describe('isLocalized', () => {
  it('accepts an object of strings', () => {
    expect(isLocalized({ es: 'Ejemplo', en: 'Example' })).toBe(true);
    expect(isLocalized({})).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isLocalized(null)).toBe(false);
    expect(isLocalized('Ejemplo')).toBe(false);
    expect(isLocalized(['Ejemplo'])).toBe(false);
    expect(isLocalized({ es: 1 })).toBe(false);
    expect(isLocalized({ es: { texto: 'Ejemplo' } })).toBe(false);
  });
});

describe('pickLocalized', () => {
  const name = { es: 'Organización de ejemplo', en: 'Example organisation' };

  it('picks the requested locale', () => {
    expect(pickLocalized(name, 'en', 'es')).toBe('Example organisation');
  });

  it("falls back to the tenant's default locale", () => {
    expect(pickLocalized({ es: 'Solo en español' }, 'en', 'es')).toBe('Solo en español');
    expect(pickLocalized({ es: 'Solo en español', en: '' }, 'en', 'es')).toBe('Solo en español');
  });

  it('never falls back to another language', () => {
    expect(pickLocalized({ ca: 'Només en català' }, 'en', 'es')).toBeUndefined();
  });
});
