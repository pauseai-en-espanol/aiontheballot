import { THEME_TEXTS } from '@aiontheballot/domain/site-theme';
import { describe, expect, it } from 'vitest';

import { palette, roles } from './brand.js';
import { AA_NON_TEXT, AA_TEXT, contrastRatio } from './contrast.js';
import { siteColourVariables, siteRoles } from './site-colours.js';

describe("a site's colours on its pages (PLAN R178)", () => {
  it('pair a site colour with the platform ink or paper, which the domain names', () => {
    expect(THEME_TEXTS).toEqual([palette.ink.toLowerCase(), palette.paper.toLowerCase()]);
  });

  it('change only the accent and the texts on it, each still readable', () => {
    for (const accent of ['#1d3557', '#ffd166', '#2a9d8f']) {
      const changed = siteRoles({ accent });
      expect(Object.keys(changed).sort()).toEqual([
        'bg.accent',
        'bg.onAccent',
        'border.onAccent',
        'fg.accentOnFill',
        'fg.accentOnInverse',
        'fg.onAccent',
        'fg.onAccentFill',
      ]);
      expect(changed['bg.accent']).toBe(accent);
      expect(contrastRatio(changed['fg.onAccent']!, accent)).toBeGreaterThanOrEqual(AA_TEXT);
      // The accent as text on the dark footer only where it reads there; the footer's own text otherwise.
      expect(
        contrastRatio(changed['fg.accentOnInverse']!, roles.bg.inverse),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(siteRoles({ accent: '#1d3557' })['fg.accentOnInverse']).toBe(roles.fg.inverse);
    expect(siteRoles({ accent: '#ffd166' })['fg.accentOnInverse']).toBe('#ffd166');
  });

  it('keep what is drawn on the accent visible on it, and what is written on those fills readable', () => {
    // Lines and fills on the accent (focus rings, borders, the solid button) need 3:1 there (WCAG 2.2 SC 1.4.11).
    for (const accent of ['#1d3557', '#ffd166', '#2a9d8f', '#000000', '#ffffff', palette.orange]) {
      const changed = siteRoles({ accent: accent.toLowerCase() });
      expect(contrastRatio(changed['border.onAccent']!, accent)).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
      expect(contrastRatio(changed['bg.onAccent']!, accent)).toBeGreaterThanOrEqual(AA_NON_TEXT);
      expect(
        contrastRatio(changed['fg.onAccentFill']!, changed['bg.onAccent']!),
      ).toBeGreaterThanOrEqual(AA_TEXT);
      expect(
        contrastRatio(changed['fg.accentOnFill']!, changed['bg.onAccent']!),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("draw the platform's own look with the platform's orange", () => {
    const orange = siteRoles({ accent: palette.orange.toLowerCase() });
    expect(orange['bg.onAccent']).toBe(roles.bg.onAccent.toLowerCase());
    expect(orange['border.onAccent']).toBe(roles.border.onAccent.toLowerCase());
    expect(orange['fg.onAccentFill']).toBe(roles.fg.onAccentFill.toLowerCase());
  });

  it("leave the platform's colours to a site without its own", () => {
    expect(siteRoles({})).toEqual({});
    expect(siteColourVariables({})).toEqual({});
  });

  it("name the preset's CSS variables for those roles", () => {
    expect(siteColourVariables({ accent: '#1d3557' })).toEqual({
      '--colors-bg-accent': '#1d3557',
      '--colors-fg-on-accent': '#ffffff',
      '--colors-fg-accent-on-inverse': roles.fg.inverse,
      '--colors-bg-on-accent': '#ffffff',
      '--colors-border-on-accent': '#ffffff',
      '--colors-fg-on-accent-fill': '#111111',
      '--colors-fg-accent-on-fill': '#1d3557',
    });
  });
});
