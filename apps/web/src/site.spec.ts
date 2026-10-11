import { describe, expect, it } from 'vitest';

import { pageCanonical, pageHref } from './site';

describe('pageHref', () => {
  it.each([
    ['', 'es', { page: 'home' } as const, '/'],
    ['', 'en', { page: 'home' } as const, '/en'],
    ['/ejemplo-a', 'es', { page: 'home' } as const, '/ejemplo-a'],
    ['', 'es', { page: 'legalNotice' } as const, '/aviso-legal'],
    ['', 'en', { page: 'confirm' } as const, '/en/avisos/confirmar'],
    ['/ejemplo-a', 'en', { page: 'privacy' } as const, '/ejemplo-a/en/privacidad'],
  ])('links root %j, locale %s, %j to %s on a Spanish site', (root, locale, target, href) => {
    expect(pageHref(root, locale, 'es', target)).toBe(href);
  });
});

describe('pageCanonical', () => {
  it.each([
    ['es', { page: 'home' } as const, 'https://ejemplo-a.test'],
    ['en', { page: 'home' } as const, 'https://ejemplo-a.test/en'],
    ['es', { page: 'privacy' } as const, 'https://ejemplo-a.test/privacidad'],
    ['en', { page: 'privacy' } as const, 'https://ejemplo-a.test/en/privacidad'],
  ])('is %s %j at %s', (locale, target, url) => {
    expect(pageCanonical('https://ejemplo-a.test', locale, 'es', target)).toBe(url);
  });
});
