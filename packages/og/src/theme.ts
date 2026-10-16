import type { SiteTheme } from '@aiontheballot/domain/site-theme';

import { roles } from '@aiontheballot/ui/brand';
import { siteRoles } from '@aiontheballot/ui/site-colours';

/**
 * The colours a card is drawn with, passed in with its content, so they are part of its hash: the platform's
 * (DEFAULT_CARD_THEME), or a site's own accent (cardTheme, PLAN R178). Ratings never take them: their icons and
 * colours are fixed (packages/ui ratings, BRIEF §3), and are drawn on `canvas`.
 */
export interface CardTheme {
  /** The poster's colour: behind the site's name, the address and the operator. */
  accent: string;
  /** Text and marks on `accent`. */
  onAccent: string;
  /** Behind a card's content: ratings sit here. */
  canvas: string;
  /** Text on `canvas`. */
  ink: string;
  /** Secondary text on `canvas`. */
  muted: string;
  /** Lines between rows on `canvas`. */
  rule: string;
}

/** The platform's colours, by role (packages/ui brand): a site's cards without colours of their own. */
export const DEFAULT_CARD_THEME: CardTheme = {
  accent: roles.bg.accent,
  onAccent: roles.fg.onAccent,
  canvas: roles.bg.canvas,
  ink: roles.fg.default,
  muted: roles.fg.muted,
  rule: roles.border.subtle,
};

/**
 * A site's card colours (PLAN R178): its accent, with the ink or paper that reads on it, on the platform's canvas,
 * where the ratings sit. The platform's for a site without its own.
 */
export const cardTheme = (site: SiteTheme): CardTheme => {
  const roles = siteRoles(site);
  return {
    ...DEFAULT_CARD_THEME,
    ...(roles['bg.accent'] ? { accent: roles['bg.accent'] } : {}),
    ...(roles['fg.onAccent'] ? { onAccent: roles['fg.onAccent'] } : {}),
  };
};
