import { describe, expect, it } from 'vitest';

import { parsePartyLogoFile, partyLogoPath } from './party-logo-path';

const SHA = 'a'.repeat(64);

describe("a party's logo, drawn small (PLAN R236)", () => {
  it('is named by its side and hash, as a PNG, when it is a PNG or a JPEG', () => {
    expect(partyLogoPath({ sha256: SHA, contentType: 'image/png' }, 96)).toBe(
      `/brand/logo/96-${SHA}.png`,
    );
    expect(partyLogoPath({ sha256: SHA, contentType: 'image/jpeg' }, 192)).toBe(
      `/brand/logo/192-${SHA}.png`,
    );
  });

  it('is named as uploaded when it is a WebP, which resvg can’t draw', () => {
    expect(partyLogoPath({ sha256: SHA, contentType: 'image/webp' }, 96)).toBe(
      `/brand/${SHA}.webp`,
    );
  });

  it('reads back only the sides the site draws, and a whole hash', () => {
    expect(parsePartyLogoFile(`96-${SHA}.png`)).toEqual({ side: 96, sha256: SHA });
    expect(parsePartyLogoFile(`192-${SHA}.png`)).toEqual({ side: 192, sha256: SHA });
    for (const file of [
      `512-${SHA}.png`,
      `096-${SHA}.png`,
      `96-${SHA}.jpg`,
      `96-${SHA.slice(1)}.png`,
      `96-${SHA.toUpperCase()}.png`,
      `96-${SHA}.png.png`,
    ]) {
      expect(parsePartyLogoFile(file), file).toBeUndefined();
    }
  });
});
