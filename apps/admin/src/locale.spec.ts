import { describe, expect, it } from 'vitest';

import { backTo, negotiateLocale, pickLocale } from './locale';

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

describe('backTo', () => {
  it('goes back to a path on this host', () => {
    expect(backTo('/t/ejemplo-a/members')).toBe('/t/ejemplo-a/members');
    expect(backTo('/')).toBe('/');
    expect(backTo('/t/ejemplo-a/e/ejemplo-2027/parties/%C3%B1')).toBe(
      '/t/ejemplo-a/e/ejemplo-2027/parties/%C3%B1',
    );
  });

  it('never to another site, nor to anything but a path', () => {
    for (const value of [
      '//otro.example/x',
      '/\\otro.example',
      'https://otro.example/',
      'javascript:alert(1)',
      // Browsers drop tabs and newlines from a Location and read `\` as `/`, so these would be `//otro.example`.
      '/\t/otro.example',
      '/\t\\otro.example',
      '/\n/otro.example',
      // Nothing a header can't carry, nor another header.
      '/\r\nSet-Cookie:a=b',
      '/\0',
      '/€',
      `/${'a'.repeat(2048)}`,
      // Nor a broken escape, which the page would refuse.
      '/%ZZ',
      '/%',
      '/a%2',
      '',
      3,
      undefined,
    ]) {
      expect(backTo(value)).toBe('/');
    }
  });
});
