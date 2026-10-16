import { describe, expect, it } from 'vitest';

import { SHARE_NETWORKS, shareLinks } from './share-links';

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
    const url = encodeURIComponent(page.url);
    expect(href).toEqual({
      whatsapp: `https://wa.me/?text=${text}%20${url}`,
      telegram: `https://t.me/share/url?url=${url}&text=${text}`,
      x: `https://x.com/intent/post?text=${text}&url=${url}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
      bluesky: `https://bsky.app/intent/compose?text=${text}%20${url}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
      email: `mailto:?subject=${text}&body=${url}`,
    });
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
