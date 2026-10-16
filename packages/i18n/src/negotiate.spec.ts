import { describe, expect, it } from 'vitest';

import { negotiateLocale, pickLocale, requestLocale } from './negotiate.js';

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

describe('pickLocale', () => {
  it('takes the language chosen with the switch over the browser’s', () => {
    expect(pickLocale('es', 'en-GB,en;q=0.9')).toBe('es');
    expect(pickLocale('en', 'es-ES')).toBe('en');
  });

  it('falls back to the browser’s language for a choice the admin doesn’t have', () => {
    expect(pickLocale(undefined, 'es-ES')).toBe('es');
    expect(pickLocale('fr', 'es-ES')).toBe('es');
    expect(pickLocale('', null)).toBe('en');
  });
});

describe('requestLocale', () => {
  it("takes the switch's cookie, else the browser's language", () => {
    expect(
      requestLocale(new Headers({ cookie: 'a=b; __Host-locale=es', 'accept-language': 'en' })),
    ).toBe('es');
    expect(
      requestLocale(new Headers({ cookie: '__Host-locale=fr', 'accept-language': 'es-ES' })),
    ).toBe('es');
    expect(requestLocale(new Headers({ cookie: 'x__Host-locale=es' }))).toBe('en');
    expect(requestLocale(new Headers())).toBe('en');
  });
});
