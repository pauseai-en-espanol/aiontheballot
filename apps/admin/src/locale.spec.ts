import { describe, expect, it } from 'vitest';

import { negotiateLocale } from './locale';

describe('negotiateLocale', () => {
  it("picks the browser's first language the admin has", () => {
    expect(negotiateLocale('es-ES,es;q=0.9,en;q=0.8')).toBe('es');
    expect(negotiateLocale('fr-FR, en-GB;q=0.7, es;q=0.5')).toBe('en');
    expect(negotiateLocale('EN-us')).toBe('en');
  });

  it('follows quality over order, and skips what the browser refuses', () => {
    expect(negotiateLocale('en;q=0.5, es;q=0.9')).toBe('es');
    expect(negotiateLocale('es;q=0, en;q=0.1')).toBe('en');
    expect(negotiateLocale('*, es;q=0.8')).toBe('es');
  });

  it('falls back to English, the source language', () => {
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale('')).toBe('en');
    expect(negotiateLocale('fr, de;q=0.9')).toBe('en');
    expect(negotiateLocale('es;q=abc')).toBe('en');
  });
});
