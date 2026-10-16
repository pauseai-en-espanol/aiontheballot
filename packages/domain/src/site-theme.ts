/**
 * A site's own colours (editorial workflow T1; public-site spec §4; PLAN R178): the names a country admin may set, each
 * a `#rrggbb` the database keeps under its name (`theme_is_colours`), and the platform's colour for any name a site
 * hasn't set. Text on a site's colour is the platform's ink or paper, whichever reads better on it; a colour on which
 * neither reaches WCAG AA is refused (T1.1), so no choice of colour can make the site or its images hard to read.
 * Ratings never take a site's colours: theirs are fixed (packages/ui ratings, BRIEF §3).
 */

/** The names a site may set (T1.2): its accent, behind its name on every page and on every share image. */
export const THEME_COLOURS = ['accent'] as const;
export type SiteTheme = Partial<Record<ThemeColour, string>>;
export type ThemeColour = (typeof THEME_COLOURS)[number];

/** WCAG 2.2 AA for body text. */
export const AA_TEXT = 4.5;

/** WCAG 2.2 AA for what isn't text but must be seen: a focus ring, a control's border, a button's fill (SC 1.4.11). */
export const AA_NON_TEXT = 3;

/** The texts a site's colour may carry: the platform's ink and paper (packages/ui palette, which a test keeps equal). */
export const THEME_TEXTS = ['#111111', '#ffffff'] as const;

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** The relative luminance of a `#rrggbb` colour (WCAG 2.2). */
export const luminance = (hex: string): number => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) {
    throw new Error(`Not a #rrggbb colour: ${hex}`);
  }
  const [r = 0, g = 0, b = 0] = match.slice(1).map((part) => channel(Number.parseInt(part, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG 2.2 contrast ratio between two `#rrggbb` colours, from 1 to 21. */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** As the database stores a colour: `#` and six lowercase hex digits. */
const COLOUR = /^#[0-9a-f]{6}$/;

/** The text that reads best on a colour, ink or paper, and its contrast ratio there. */
export const readableText = (background: string): { text: string; ratio: number } => {
  const [ink, paper] = THEME_TEXTS.map((text) => ({
    text,
    ratio: contrastRatio(text, background),
  })) as [{ text: string; ratio: number }, { text: string; ratio: number }];
  return ink.ratio >= paper.ratio ? ink : paper;
};

export type ThemeProblem = 'unknown' | 'format' | 'contrast';

/** Why a colour can't be a site's: a name the site doesn't use, not `#rrggbb` in lowercase, or no text reads on it. */
export const themeColourProblem = (name: string, value: unknown): ThemeProblem | undefined => {
  if (!(THEME_COLOURS as readonly string[]).includes(name)) {
    return 'unknown';
  }
  if (typeof value !== 'string' || !COLOUR.test(value)) {
    return 'format';
  }
  return readableText(value).ratio < AA_TEXT ? 'contrast' : undefined;
};

/**
 * A stored theme as the site draws it: the names it knows with colours it can use. Anything else (a name from a
 * later version, a colour written past the API) is left to the platform's colour rather than drawn unreadable.
 */
export const readTheme = (value: unknown): SiteTheme => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(
    entries.filter(([name, colour]) => themeColourProblem(name, colour) === undefined),
  ) as SiteTheme;
};
