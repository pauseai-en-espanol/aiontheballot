import { describe, expect, it } from 'vitest';

import { cardHash } from './hash.js';

const card = { label: 'Próximamente', name: 'Inquilino de ejemplo A' };
const FINGERPRINTS = { 'coming-soon': '0123456789abcdef' };

describe('cardHash', () => {
  it('is stable for the same template, size and data, and changes with any of them', () => {
    const base = cardHash('coming-soon', '1200x630', card, FINGERPRINTS);
    expect(cardHash('coming-soon', '1200x630', { ...card }, FINGERPRINTS)).toBe(base);
    expect(cardHash('coming-soon', '1080x1080', card, FINGERPRINTS)).not.toBe(base);
    expect(cardHash('coming-soon', '1200x630', { ...card, label: 'Otra' }, FINGERPRINTS)).not.toBe(
      base,
    );
    expect(base).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes with the template’s fingerprint: a picture drawn differently gets a new URL', () => {
    expect(
      cardHash('coming-soon', '1200x630', card, { 'coming-soon': 'fedcba9876543210' }),
    ).not.toBe(cardHash('coming-soon', '1200x630', card, FINGERPRINTS));
  });

  it('refuses a template the build gave no fingerprint, as in source', () => {
    expect(() => cardHash('coming-soon', '1200x630', card)).toThrow(/no fingerprint/);
    expect(() => cardHash('coming-soon', '1200x630', card, {})).toThrow(/build @aiontheballot\/og/);
  });
});
