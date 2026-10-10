import type { PublicHome } from '@aiontheballot/domain/public-home';

import { describe, expect, it, vi } from 'vitest';

import { isDrawableLogo } from './home-image';
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
  brand: {},
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
      initiativeLead: 'Una iniciativa de',
    });
  });

  it("names the operator's logo for orange, which then changes its hash", () => {
    const logo = { sha256: 'a'.repeat(64), contentType: 'image/png' };
    const withLogo = { ...home, brand: { operator_logo_on_accent: logo } };
    const card = homeCardContent(withLogo, 'es', 'https://ejemplo.example.test');
    expect(card.operatorLogo).toEqual(logo);
    const plain = homeCardContent(home, 'es', 'https://ejemplo.example.test');
    expect(homeCardHash(card, '1200x630')).not.toBe(homeCardHash(plain, '1200x630'));
  });

  it('leaves a WebP logo out of the card, which satori cannot draw', () => {
    const withWebp = {
      ...home,
      brand: { operator_logo_on_accent: { sha256: 'a'.repeat(64), contentType: 'image/webp' } },
    };
    expect(
      homeCardContent(withWebp, 'es', 'https://ejemplo.example.test').operatorLogo,
    ).toBeUndefined();
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

describe('a logo on a card', () => {
  it('is drawn only when it is what it claims, at a sane size', () => {
    const png = { width: 878, height: 240, type: 'image/png' } as const;
    expect(isDrawableLogo(png, 'image/png')).toBe(true);
    expect(isDrawableLogo(png, 'image/jpeg')).toBe(false);
    expect(isDrawableLogo({ ...png, width: 8000, height: 8000 }, 'image/png')).toBe(false);
    expect(isDrawableLogo({ ...png, height: 0 }, 'image/png')).toBe(false);
    expect(isDrawableLogo(undefined, 'image/png')).toBe(false);
  });
});
