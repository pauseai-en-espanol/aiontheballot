import { readableText, type SiteTheme, THEME_TEXTS } from '@aiontheballot/domain/site-theme';

import { roles } from './brand.js';
import { AA_TEXT, contrastRatio } from './contrast.js';

/**
 * The roles a site's colours change: its accent, the text, lines and fills on it and the text on those fills, and the
 * accent as text on the dark surfaces.
 */
type SiteRole =
  | 'bg.accent'
  | 'fg.onAccent'
  | 'fg.accentOnInverse'
  | 'bg.onAccent'
  | 'border.onAccent'
  | 'fg.onAccentFill'
  | 'fg.accentOnFill';

/**
 * The roles a site's own colours redefine (PLAN R178; ADR-0003 §5: pages use colours only through the roles): the
 * accent, the ink or paper that reads on it, and the accent where it is text on the dark surfaces, or their own
 * text where the accent doesn't read there. Nothing for a site that keeps the platform's.
 */
export const siteRoles = (theme: SiteTheme): Partial<Record<SiteRole, string>> => {
  const { accent } = theme;
  if (!accent) {
    return {};
  }
  // Ink or paper, whichever reads on the accent (at least AA_TEXT, so past AA_NON_TEXT for a line or a fill), and the
  // other one on a fill of it; the accent reads on that fill as it does under the same ink or paper.
  const onAccent = readableText(accent).text;
  const [ink, paper] = THEME_TEXTS;
  return {
    'bg.accent': accent,
    'fg.onAccent': onAccent,
    'fg.accentOnInverse':
      contrastRatio(accent, roles.bg.inverse) >= AA_TEXT ? accent : roles.fg.inverse,
    'bg.onAccent': onAccent,
    'border.onAccent': onAccent,
    'fg.onAccentFill': onAccent === ink ? paper : ink,
    'fg.accentOnFill': accent,
  };
};

/** A role's CSS variable, as Panda names it: `fg.onAccent` is `--colors-fg-on-accent`. */
const variable = (role: string) =>
  `--colors-${role.replaceAll('.', '-').replaceAll(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`;

/** The CSS variables a site's root sets, so every page under it draws in the site's colours. */
export const siteColourVariables = (theme: SiteTheme): Record<string, string> =>
  Object.fromEntries(
    Object.entries(siteRoles(theme)).map(([role, value]) => [variable(role), value]),
  );
