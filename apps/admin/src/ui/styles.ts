import { css } from '@styled-system/css';

/**
 * The signed-in screens' look: the preset's colours by role only (packages/ui), 44px controls and a visible focus
 * ring (WCAG 2.2 AA), states marked in words or shapes as well as colour.
 */

export const focusRing = {
  outline: '3px solid',
  outlineColor: 'fg.default',
  outlineOffset: '2px',
} as const;

/** Hidden until focused: the first stop for keyboard users, past the header and navigation. */
export const skipLink = css({
  position: 'absolute',
  insetInlineStart: '2',
  insetBlockStart: '-20',
  zIndex: 10,
  paddingInline: '4',
  paddingBlock: '2',
  bg: 'bg.inverse',
  color: 'fg.inverse',
  fontWeight: 'bold',
  _focusVisible: { ...focusRing, insetBlockStart: '2', outlineColor: 'fg.default' },
});

export const header = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3',
  paddingInline: { base: '4', md: '6' },
  paddingBlock: '3',
  borderBlockEndWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

export const headerGroup = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '3',
});

export const platformLink = css({
  fontWeight: 'bold',
  color: 'fg.default',
  textDecoration: 'none',
  _hover: { textDecoration: 'underline' },
  _focusVisible: focusRing,
});

export const siteName = css({ fontSize: 'lg', fontWeight: 'bold' });

export const muted = css({ color: 'fg.muted' });

export const nav = css({
  paddingInline: { base: '4', md: '6' },
  borderBlockEndWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  bg: 'bg.subtle',
});

export const navList = css({ display: 'flex', flexWrap: 'wrap', gap: '1', listStyle: 'none' });

/** The current section is marked by a thick underline and bold text, besides aria-current. */
export const navLink = css({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '11',
  paddingInline: '3',
  color: 'fg.default',
  textDecoration: 'none',
  borderBlockEndWidth: '3px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  _hover: { textDecoration: 'underline' },
  _focusVisible: focusRing,
  '&[aria-current="page"]': { fontWeight: 'bold', borderColor: 'border.default' },
});

export const main = css({
  maxWidth: '72rem',
  marginInline: 'auto',
  paddingInline: { base: '4', md: '6' },
  paddingBlock: { base: '6', md: '10' },
  _focusVisible: { outline: 'none' },
});

/** A single narrow column, for the pages outside a tenant (the site list, not found). */
export const narrow = css({
  maxWidth: '40rem',
  marginInline: 'auto',
  paddingInline: '4',
  paddingBlock: { base: '10', md: '16' },
});

export const h1 = css({
  fontSize: '2xl',
  fontWeight: 'bold',
  lineHeight: 'tight',
  marginBlockEnd: '3',
});

export const h2 = css({
  fontSize: 'xl',
  fontWeight: 'bold',
  marginBlockStart: '8',
  marginBlockEnd: '3',
});

export const text = css({ color: 'fg.muted', marginBlockEnd: '4', maxWidth: '65ch' });

export const link = css({
  color: 'fg.default',
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
  _focusVisible: focusRing,
});

export const list = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  marginBlockEnd: '6',
  paddingInlineStart: '5',
  listStyle: 'disc',
});

export const cards = css({
  display: 'grid',
  gridTemplateColumns: { base: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
  gap: '4',
  listStyle: 'none',
  marginBlockEnd: '6',
});

export const card = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  padding: '4',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  borderRadius: 'md',
});

export const cardLink = css({
  fontWeight: 'bold',
  fontSize: 'lg',
  color: 'fg.default',
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
  _focusVisible: focusRing,
});

/** A note that stands out from the text: bordered and marked in words, never by colour alone. */
export const notice = css({
  padding: '3',
  marginBlockEnd: '6',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.subtle',
  color: 'fg.default',
  maxWidth: '65ch',
});

export const tableWrap = css({ overflowX: 'auto', marginBlockEnd: '6' });

export const table = css({
  width: '100%',
  borderCollapse: 'collapse',
  '& th, & td': {
    textAlign: 'start',
    verticalAlign: 'top',
    paddingInline: '3',
    paddingBlock: '3',
    borderBlockEndWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border.subtle',
  },
  '& th': { fontWeight: 'bold' },
  '& thead th': { borderColor: 'border.default' },
  '& caption': { textAlign: 'start', fontWeight: 'bold', marginBlockEnd: '2' },
});

export const button = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2',
  minHeight: '11',
  paddingInline: '5',
  borderRadius: 'md',
  bg: 'bg.accent',
  color: 'fg.onAccent',
  fontWeight: 'bold',
  cursor: 'pointer',
  _focusVisible: focusRing,
  '&[aria-disabled="true"]': { cursor: 'progress', opacity: 0.7 },
});

export const secondaryButton = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2',
  minHeight: '11',
  paddingInline: '4',
  borderRadius: 'md',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontWeight: 'bold',
  cursor: 'pointer',
  _focusVisible: focusRing,
  '&[aria-disabled="true"]': { cursor: 'progress', opacity: 0.7 },
});

/** A secondary action that reads as a link but acts in place. */
export const textButton = css({
  minHeight: '6',
  padding: '0',
  bg: 'transparent',
  color: 'fg.default',
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
  cursor: 'pointer',
  _focusVisible: focusRing,
});

export const tags = css({ display: 'flex', flexWrap: 'wrap', gap: '2', listStyle: 'none' });

/** A role, or any short label: outlined, so it never depends on a fill colour. */
export const tag = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2',
  minHeight: '8',
  paddingInlineStart: '3',
  paddingInlineEnd: '1',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'full',
  '&[data-plain]': { paddingInlineEnd: '3' },
});

export const tagButton = css({
  minHeight: '6',
  minWidth: '6',
  paddingInline: '2',
  borderRadius: 'full',
  bg: 'bg.subtle',
  color: 'fg.default',
  textDecoration: 'underline',
  cursor: 'pointer',
  _focusVisible: focusRing,
});

export const inlineForm = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  gap: '2',
});

export const form = css({ display: 'flex', flexDirection: 'column', gap: '5', maxWidth: '40rem' });

export const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5' });

export const label = css({ fontWeight: 'bold' });

export const hint = css({ color: 'fg.muted', fontSize: 'sm' });

/** A form's status line: it takes focus after a change, so it shows the focus ring then. */
export const status = css({ color: 'fg.muted', fontSize: 'sm', _focusVisible: focusRing });

export const input = css({
  minHeight: '11',
  paddingInline: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontSize: 'md',
  _focusVisible: focusRing,
  _invalid: { borderWidth: '2px' },
});

export const textarea = css({
  minHeight: '40',
  padding: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontSize: 'md',
  fontFamily: 'inherit',
  _focusVisible: focusRing,
  _invalid: { borderWidth: '2px' },
});

export const select = css({
  minHeight: '11',
  paddingInline: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontSize: 'md',
  _focusVisible: focusRing,
});

/** An error the whole form shares: bordered and marked in words, never by colour alone. */
export const alert = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  padding: '3',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.subtle',
  color: 'fg.default',
});

export const menu = css({
  minWidth: '14rem',
  padding: '1',
  bg: 'bg.canvas',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  boxShadow: 'md',
  zIndex: 20,
  _focusVisible: { outline: 'none' },
});

export const menuItem = css({
  display: 'flex',
  alignItems: 'center',
  minHeight: '11',
  paddingInline: '3',
  borderRadius: 'sm',
  color: 'fg.default',
  textDecoration: 'none',
  cursor: 'pointer',
  '&[data-highlighted]': { bg: 'bg.subtle', textDecoration: 'underline' },
  '&[aria-current="page"]': { fontWeight: 'bold' },
});

export const menuSeparator = css({
  marginBlock: '1',
  borderBlockStartWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

export const backdrop = css({ position: 'fixed', inset: '0', bg: 'bg.inverse/50', zIndex: 30 });

export const dialogPositioner = css({
  position: 'fixed',
  inset: '0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '4',
  zIndex: 40,
});

export const dialog = css({
  width: '100%',
  maxWidth: '32rem',
  padding: '6',
  bg: 'bg.canvas',
  color: 'fg.default',
  borderRadius: 'md',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  display: 'flex',
  flexDirection: 'column',
  gap: '4',
  _focusVisible: { outline: 'none' },
});

export const dialogTitle = css({ fontSize: 'xl', fontWeight: 'bold' });

export const actions = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '3',
  justifyContent: 'flex-end',
});

export const visuallyHidden = css({ srOnly: true });

export const h3 = css({ fontSize: 'lg', fontWeight: 'bold', marginBlockEnd: '2' });

export const fieldset = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  border: 'none',
  padding: '0',
});

export const tabList = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '1',
  borderBlockEndWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

/** The selected tab is marked by a thick underline and bold text, besides aria-selected. */
export const tab = css({
  minHeight: '11',
  paddingInline: '3',
  bg: 'transparent',
  color: 'fg.default',
  cursor: 'pointer',
  borderBlockEndWidth: '3px',
  borderStyle: 'solid',
  borderColor: 'transparent',
  _focusVisible: focusRing,
  '&[aria-selected="true"]': { fontWeight: 'bold', borderColor: 'border.default' },
});

export const tabPanel = css({
  display: 'flex',
  flexDirection: 'column',
  paddingBlockStart: '2',
  _focusVisible: focusRing,
});

export const numberInput = css({
  width: '10rem',
  minHeight: '11',
  paddingInline: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontSize: 'md',
  _focusVisible: focusRing,
  _invalid: { borderWidth: '2px' },
});

export const checkboxField = css({ display: 'flex', alignItems: 'center', gap: '3' });

export const checkbox = css({
  width: '6',
  height: '6',
  accentColor: 'fg.default',
  _focusVisible: focusRing,
});

/** Settings shown to those who can't change them: the name, then its value in words. */
export const facts = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  marginBlockEnd: '4',
  maxWidth: '65ch',
  '& dt': { fontWeight: 'bold' },
});

export const buttonRow = css({ display: 'flex', flexWrap: 'wrap', gap: '3' });

export const versions = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  listStyle: 'none',
});

export const details = css({
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  borderRadius: 'md',
  padding: '3',
});

export const summary = css({ cursor: 'pointer', minHeight: '6', _focusVisible: focusRing });

export const versionText = css({ marginBlockStart: '3' });

/** Text as it was written, line breaks kept: Markdown is shown, not rendered. */
export const prose = css({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '75ch' });

export const prefixed = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  fontFamily: 'mono',
});
