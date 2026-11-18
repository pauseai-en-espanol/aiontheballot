import { describe, expect, it } from 'vitest';

import { SHARE_NETWORKS, sharedUrl, shareLinks, taggedUrl } from './share-links';

const page = {
  url: 'https://ejemplo.example.test/generales/partidos/partido-ejemplo-a',
  text: 'Partido Ejemplo A & co. · Inquilino de ejemplo',
};

describe("a page's share links (R177)", () => {
  it("give every network its own share address, with the page's address and title, and nothing else", () => {
    const links = shareLinks(page);
    expect(links.map((link) => link.network)).toEqual([...SHARE_NETWORKS]);
    const href = Object.fromEntries(links.map((link) => [link.network, link.href]));
    const text = encodeURIComponent(page.text);
    // Each network's address names it as its channel (PLAN R239).
    const url = (network: string) =>
      encodeURIComponent(`${page.url}?utm_source=${network}&utm_medium=share`);
    expect(href).toEqual({
      whatsapp: `https://wa.me/?text=${text}%20${url('whatsapp')}`,
      telegram: `https://t.me/share/url?url=${url('telegram')}&text=${text}`,
      x: `https://x.com/intent/post?text=${text}&url=${url('x')}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url('facebook')}`,
      bluesky: `https://bsky.app/intent/compose?text=${text}%20${url('bluesky')}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url('linkedin')}`,
      email: `mailto:?subject=${text}&body=${url('email')}`,
    });
  });

  it('tags an address that already has a query after it (the preview’s hash, R215)', () => {
    expect(taggedUrl('https://ejemplo.example.test/generales?v=0123456789ab', 'x')).toBe(
      'https://ejemplo.example.test/generales?v=0123456789ab&utm_source=x&utm_medium=share',
    );
  });

  it('read back as the same address and title: spaces as %20, never +, which mail clients keep', () => {
    for (const { network, href } of shareLinks(page)) {
      expect(href, network).not.toContain('+');
      const params = new URL(href).searchParams;
      const values = [...params.values()].join(' ');
      if (network !== 'facebook' && network !== 'linkedin') {
        expect(values, network).toContain(page.text);
      }
      expect(values, network).toContain(page.url);
    }
  });
});

describe("a page's shared address (R215)", () => {
  const canonical = 'https://ejemplo.example.test/generales';
  it("carries its link preview's content hash, so a network fetches a fresh preview once it changes", () => {
    expect(sharedUrl(canonical, '/generales/og/overview/1200x630.0123456789ab.png')).toBe(
      `${canonical}?v=0123456789ab`,
    );
    expect(sharedUrl(`${canonical}/en`, '/en/og/home.1200x630.ba9876543210.png')).toBe(
      `${canonical}/en?v=ba9876543210`,
    );
  });

  it('is the canonical address itself when the preview names no hash', () => {
    expect(sharedUrl(canonical, '/brand/logo.png')).toBe(canonical);
    expect(sharedUrl(canonical, '/generales/og/overview/1200x630.png')).toBe(canonical);
  });
});
