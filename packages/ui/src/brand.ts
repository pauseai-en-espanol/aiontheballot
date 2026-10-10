/**
 * The brand palette, from PauseAI's brand kit, and the greys around it. Pages use it through the preset's semantic
 * tokens; share images, which can't use Panda classes, read these values directly (ADR-0003 §5).
 *
 * Orange text on white fails WCAG AA (about 2.2:1): orange is a fill behind ink text, or text on ink.
 */
export const palette = {
  orange: '#FF9416',
  ink: '#111111',
  paper: '#FFFFFF',
  grey: {
    50: '#F4F4F3',
    200: '#D6D6D6',
    400: '#A8A8A8',
    700: '#4A4A4A',
    900: '#2A2A2A',
  },
} as const;

/**
 * The colours each surface uses, by role. They are the only colours pages use, so a dark mode, or a tenant's own
 * colours (ADR-0003 §5), means redefining these and nothing else. Every text colour is checked against the
 * backgrounds it sits on (contrast.spec.ts).
 */
export const roles = {
  bg: {
    canvas: palette.paper,
    subtle: palette.grey[50],
    inverse: palette.ink,
    accent: palette.orange,
  },
  fg: {
    default: palette.ink,
    muted: palette.grey[700],
    onAccent: palette.ink,
    inverse: palette.paper,
    inverseMuted: palette.grey[200],
    inverseSubtle: palette.grey[400],
    accentOnInverse: palette.orange,
  },
  border: {
    default: palette.ink,
    subtle: palette.grey[200],
    inverse: palette.grey[900],
  },
} as const;

/** Which text colours may sit on which backgrounds. */
export const textOn = {
  canvas: ['default', 'muted'],
  subtle: ['default', 'muted'],
  accent: ['onAccent'],
  inverse: ['inverse', 'inverseMuted', 'inverseSubtle', 'accentOnInverse'],
} as const satisfies Record<keyof typeof roles.bg, readonly (keyof typeof roles.fg)[]>;

/**
 * PauseAI's typefaces (pauseai.info/press), self-hosted by each app, which sets these CSS variables. An app that
 * doesn't load them gets the system font.
 */
export const fontVariables = {
  display: '--font-display',
  body: '--font-body',
  numeric: '--font-numeric',
} as const;
