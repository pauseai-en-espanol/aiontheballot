/**
 * The sides a party's logo is served at (PLAN R236): three times each of the site's two boxes (30 and 64 px, a little
 * more for the small one), for dense screens. Apart from the renderer, so a page names them without loading resvg.
 */
export const LOGO_SIDES = [96, 192] as const;
export type LogoSide = (typeof LOGO_SIDES)[number];

export const isLogoSide = (value: number): value is LogoSide =>
  (LOGO_SIDES as readonly number[]).includes(value);

/** The logos redrawn small: what resvg draws. Anything else (WebP) is served as uploaded. */
export const SHRUNK_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg']);
