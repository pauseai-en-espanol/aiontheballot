import { describe, expect, it } from 'vitest';

import { RESERVED_ELECTION_SLUGS } from './routing.js';
import {
  SITE_WORDS,
  sitePath,
  siteWords,
  TENANT_LEVEL_SEGMENTS,
  TENANT_LEVEL_WORDS,
  toInternalPath,
} from './site-paths.js';

/** The database's slug shape (`app.slug`): every word must be one, or it couldn't be a path segment beside slugs. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('the words of a site', () => {
  it('name the same pages in every language, each a distinct slug-shaped word', () => {
    for (const [locale, words] of Object.entries(SITE_WORDS)) {
      expect(Object.keys(words).sort(), locale).toEqual(Object.keys(SITE_WORDS.en).sort());
      for (const word of Object.values(words)) {
        expect(word, `${locale}: ${word}`).toMatch(SLUG);
      }
      const tenantLevel = TENANT_LEVEL_WORDS.map((key) => words[key]);
      expect(new Set(tenantLevel).size, locale).toBe(tenantLevel.length);
    }
  });

  it("reserve every language's tenant-level words, so no election can take one as its slug", () => {
    expect(TENANT_LEVEL_SEGMENTS).toEqual(
      expect.arrayContaining(['aviso-legal', 'privacidad', 'legal-notice', 'privacy', 'avisos']),
    );
    for (const word of TENANT_LEVEL_SEGMENTS) {
      expect(RESERVED_ELECTION_SLUGS).toContain(word);
    }
  });

  it('fall back to English for a language without its own', () => {
    expect(siteWords('ca')).toBe(SITE_WORDS.en);
  });
});

describe('sitePath', () => {
  it.each([
    [{ page: 'home' } as const, '/', '/'],
    [{ page: 'legalNotice' } as const, '/aviso-legal', '/legal-notice'],
    [{ page: 'privacy' } as const, '/privacidad', '/privacy'],
    [{ page: 'about' } as const, '/quienes-somos', '/about'],
    [{ page: 'updates' } as const, '/avisos', '/updates'],
    [{ page: 'confirm' } as const, '/avisos/confirmar', '/updates/confirm'],
    [{ page: 'unsubscribe' } as const, '/avisos/baja', '/updates/unsubscribe'],
    [{ page: 'election', election: 'e' } as const, '/e', '/e'],
    [{ page: 'table', election: 'e' } as const, '/e/tabla', '/e/table'],
    [{ page: 'methodology', election: 'e' } as const, '/e/metodologia', '/e/methodology'],
    [{ page: 'party', election: 'e', party: 'p' } as const, '/e/partidos/p', '/e/parties/p'],
    [
      { page: 'cell', election: 'e', party: 'p', criterion: 'c' } as const,
      '/e/partidos/p/c',
      '/e/parties/p/c',
    ],
    [
      { page: 'criterion', election: 'e', criterion: 'c' } as const,
      '/e/criterios/c',
      '/e/criteria/c',
    ],
    [{ page: 'report', election: 'e' } as const, '/e/informar', '/e/report'],
    [{ page: 'reportSend', election: 'e' } as const, '/e/informar/enviar', '/e/report/send'],
    [{ page: 'corrections', election: 'e' } as const, '/e/correcciones', '/e/corrections'],
  ])('%j is %s in Spanish and %s in English', (target, es, en) => {
    expect(sitePath('es', target)).toBe(es);
    expect(sitePath('en', target)).toBe(en);
  });

  it("round-trips through toInternalPath onto the app's routes", () => {
    for (const target of [
      { page: 'legalNotice' },
      { page: 'confirm' },
      { page: 'table', election: 'e' },
      { page: 'cell', election: 'e', party: 'p', criterion: 'c' },
      { page: 'criterion', election: 'e', criterion: 'c' },
      { page: 'report', election: 'e' },
      { page: 'reportSend', election: 'e' },
      { page: 'corrections', election: 'e' },
    ] as const) {
      expect(toInternalPath('es', sitePath('es', target))).toBe(sitePath('en', target));
    }
  });
});

describe('toInternalPath', () => {
  it.each([
    ['/', '/'],
    ['/aviso-legal', '/legal-notice'],
    ['/avisos', '/updates'],
    ['/avisos/baja', '/updates/unsubscribe'],
    ['/avisos/otra-cosa', '/updates/otra-cosa'],
    ['/generales-2026', '/generales-2026'],
    ['/generales-2026/metodologia', '/generales-2026/methodology'],
    ['/generales-2026/tabla', '/generales-2026/table'],
    ['/generales-2026/partidos/p/c', '/generales-2026/parties/p/c'],
    ['/generales-2026/informar/enviar', '/generales-2026/report/send'],
    ['/brand/icon/32.abc.png', '/brand/icon/32.abc.png'],
    ['/og/home.1200x630.abc.png', '/og/home.1200x630.abc.png'],
    ['/favicon.ico', '/favicon.ico'],
  ])('maps %s on a Spanish site to %s', (path, internal) => {
    expect(toInternalPath('es', path)).toBe(internal);
  });

  it.each([
    '/legal-notice',
    '/privacy',
    '/about',
    '/updates',
    '/avisos/confirm',
    '/e/parties/p',
    '/e/methodology',
    '/e/table',
    '/e/report',
    '/e/informar/send',
    '/e/corrections',
  ])("refuses the app's own word %s on a Spanish site", (path) => {
    expect(toInternalPath('es', path)).toBeUndefined();
  });

  it('leaves an English site as it is', () => {
    expect(toInternalPath('en', '/updates/confirm')).toBe('/updates/confirm');
    expect(toInternalPath('en', '/e/parties/p')).toBe('/e/parties/p');
  });
});
