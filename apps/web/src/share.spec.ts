import type { PublicHome } from '@aiontheballot/domain/public-home';

import { describe, expect, it, vi } from 'vitest';

import { createImageCache } from './image-cache';
import {
  homeCardContent,
  homeCardHash,
  imagePath,
  ogLocale,
  pageUrl,
  parseImageFile,
} from './share';

const home: PublicHome = {
  tenant: {
    displayName: { es: 'Inquilino de ejemplo', en: 'Example tenant' },
    defaultLocale: 'es',
    countryCode: 'XA',
    methodologyKind: 'demands',
  },
  operator: {
    displayName: { es: 'Organización de ejemplo' },
    url: null,
    contactEmail: null,
    newsletterUrl: null,
  },
  election: { name: { es: 'Elecciones de ejemplo' }, date: '2030-01-15' },
};

describe('pageUrl', () => {
  it('leaves the default locale out and prefixes the others', () => {
    expect(pageUrl('https://ejemplo.example.test', 'es', 'es')).toBe(
      'https://ejemplo.example.test',
    );
    expect(pageUrl('https://ejemplo.example.test', 'en', 'es', '/og/x.png')).toBe(
      'https://ejemplo.example.test/en/og/x.png',
    );
    expect(pageUrl('https://plataforma.example.test/ejemplo', 'es', 'es', '/og/x.png')).toBe(
      'https://plataforma.example.test/ejemplo/og/x.png',
    );
  });
});

describe('share image files', () => {
  it('round-trip through their path', () => {
    const path = imagePath('home', '1080x1920', '0123456789ab');
    expect(path).toBe('/og/home.1080x1920.0123456789ab.png');
    expect(parseImageFile(path.slice('/og/'.length))).toEqual({
      template: 'home',
      size: '1080x1920',
      hash: '0123456789ab',
    });
  });

  it.each([
    'home.1200x630.0123456789ab.jpg',
    'home.1200x631.0123456789ab.png',
    'party.1200x630.0123456789ab.png',
    'home.1200x630.0123456789AB.png',
    'home.1200x630.0123.png',
    '../home.1200x630.0123456789ab.png',
  ])('refuses %s', (file) => {
    expect(parseImageFile(file)).toBeUndefined();
  });
});

describe('the home card', () => {
  it('takes its texts from the data and the messages, and the address from the canonical base', () => {
    expect(homeCardContent(home, 'es', 'https://ejemplo.example.test')).toEqual({
      label: 'Próximamente · Elecciones de ejemplo · 15 de enero de 2030',
      name: 'Inquilino de ejemplo',
      question: '¿Qué proponen los partidos frente a los riesgos de la IA?',
      address: 'ejemplo.example.test',
      initiative: 'Una iniciativa de Organización de ejemplo',
    });
  });

  it('gets a new hash when anything on it changes', () => {
    const card = homeCardContent(home, 'es', 'https://ejemplo.example.test');
    const other = homeCardContent(
      { ...home, election: null },
      'es',
      'https://ejemplo.example.test',
    );
    expect(homeCardHash(card, '1200x630')).toBe(homeCardHash({ ...card }, '1200x630'));
    expect(homeCardHash(other, '1200x630')).not.toBe(homeCardHash(card, '1200x630'));
  });
});

describe('ogLocale', () => {
  it("joins the language and the tenant's country", () => {
    expect(ogLocale('es', 'ES')).toBe('es_ES');
  });
});

describe('the image cache', () => {
  const png = (n: number) => new Uint8Array([n]);

  it('renders each key once, even when asked twice at the same time', async () => {
    const cache = createImageCache();
    const render = vi.fn(async () => png(1));
    await Promise.all([cache('a', render), cache('a', render)]);
    await cache('a', render);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('forgets the least recently used key when full', async () => {
    const cache = createImageCache({ maxEntries: 2 });
    const render = vi.fn(async () => png(1));
    await cache('a', render);
    await cache('b', render);
    await cache('a', render);
    await cache('c', render);
    await cache('a', render);
    expect(render).toHaveBeenCalledTimes(3);
    await cache('b', render);
    expect(render).toHaveBeenCalledTimes(4);
  });

  it("doesn't keep a failed render", async () => {
    const cache = createImageCache();
    await expect(cache('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(cache('a', async () => png(2))).resolves.toEqual(png(2));
  });
});
