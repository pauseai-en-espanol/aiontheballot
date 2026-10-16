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

/**
 * A row of sections: on a phone one line that scrolls sideways (admin forms §1.11, PLAN R197), rather than rows that
 * push the page's content below the fold; from a tablet on, as many rows as it takes.
 */
export const navList = css({
  display: 'flex',
  flexWrap: { base: 'nowrap', md: 'wrap' },
  overflowX: { base: 'auto', md: 'visible' },
  scrollSnapType: { base: 'x proximity', md: 'none' },
  // Room for a focused link's outline inside the scrolling row.
  paddingBlock: '1',
  gap: '1',
  listStyle: 'none',
  '& > li': { flexShrink: '0', scrollSnapAlign: 'start' },
});

/** The current section is marked by a thick underline and bold text, besides aria-current. */
export const navLink = css({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '11',
  paddingInline: '3',
  whiteSpace: 'nowrap',
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
/** A button that reads as a link: still a target of 44 px (admin forms §2, sign-in; WCAG 2.5.8). */
export const textButton = css({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '11',
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

/** A table column shown only from tablet width up: on a phone, what it holds goes under the row's name instead. */
export const wideColumn = css({ display: { base: 'none', md: 'table-cell' } });

/** The phone's copy of what a `wideColumn` holds, under the row's name: small, on a line of its own. */
export const narrowOnly = css({
  display: { base: 'block', md: 'none' },
  fontWeight: 'normal',
  fontSize: 'sm',
  color: 'fg.muted',
  overflowWrap: 'anywhere',
});

/** Text with long unbroken strings (an email address, a row id, a stored value), which may wrap anywhere. */
export const breakAnywhere = css({
  overflowWrap: 'anywhere',
  '& code': { overflowWrap: 'anywhere' },
});

/** The phone's copy of a row's actions, under another cell's content. */
export const narrowActions = css({ display: { base: 'block', md: 'none' }, marginBlockStart: '3' });

/** A row's actions in a table: side by side while they fit, one under another when they don't. */
export const rowActions = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2',
  alignItems: 'flex-start',
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
  '&[aria-invalid=true]': { borderWidth: '3px' },
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
  '&[aria-invalid=true]': { borderWidth: '3px' },
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
/** An uploaded logo, as the public site shows it: within a box, never stretched, on a plain background. */
export const logo = css({
  display: 'block',
  maxBlockSize: '20',
  maxInlineSize: '64',
  objectFit: 'contain',
  marginBlockEnd: '3',
  padding: '2',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

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
  '&[aria-invalid=true]': { borderWidth: '3px' },
});

export const checkboxField = css({ display: 'flex', alignItems: 'center', gap: '3' });

/** The territory picker's boxes; those inside a territory folded under it, indented past its box (PLAN R201). */
export const territoryList = css({ display: 'flex', flexDirection: 'column', gap: '2' });

export const territoryWithin = css({ paddingInlineStart: '9' });

export const checkbox = css({
  width: '6',
  height: '6',
  // Never narrower than 24 px when its label wraps (WCAG 2.5.8).
  flexShrink: '0',
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

/** An election's sections: a row of links inside the page, the current one marked as in the site's bar. */
export const subNav = css({
  marginBlock: '4',
  borderBlockEndWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

export const section = css({ marginBlockStart: '2' });

/** A short label above a heading: where the page sits. */
export const eyebrow = css({
  color: 'fg.muted',
  fontSize: 'sm',
  fontWeight: 'bold',
  marginBlockEnd: '1',
});

export const confirm = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  alignItems: 'flex-start',
});

/** A consequence to notice: bold and marked with a sign, never by colour alone. */
export const warning = css({ fontWeight: 'bold', fontSize: 'sm', color: 'fg.default' });

export const colourInput = css({
  width: '16',
  height: '11',
  padding: '1',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  cursor: 'pointer',
  _focusVisible: focusRing,
});

/** The site's colour with the text the site writes on it (PLAN R178): a banner as the public site's. */
export const colourSample = css({
  display: 'flex',
  alignItems: 'center',
  minHeight: '16',
  paddingInline: '5',
  fontWeight: 'bold',
  fontSize: 'xl',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
});

/** The short title's field is no wider than the public table's column it heads (W22). */
export const shortTitle = css({ maxWidth: '14rem' });

export const ordered = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  listStyle: 'none',
  marginBlockEnd: '4',
});

export const orderedItem = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3',
  padding: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  borderRadius: 'md',
});

export const orderedName = css({ display: 'flex', flexDirection: 'column', gap: '1' });

/** A list item's lead (a party's logo or colour) beside its name and facts. */
export const orderedLead = css({ display: 'flex', alignItems: 'center', gap: '3', minWidth: '0' });

export const checklist = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  listStyle: 'none',
  marginBlockEnd: '2',
});

/** A checklist item: its sign and its words say whether it is done; the missing ones are bold too. */
export const checkItem = css({
  display: 'flex',
  gap: '2',
  alignItems: 'baseline',
  fontWeight: 'bold',
  '&[data-done]': { fontWeight: 'normal', color: 'fg.muted' },
});

/** The end of every page: the language switch. */
export const footer = css({
  maxWidth: '72rem',
  marginInline: 'auto',
  paddingInline: { base: '4', md: '6' },
  paddingBlock: '6',
  borderBlockStartWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

export const languageSwitch = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '3',
});

/** The quote form beside its source's text, on screens wide enough for both; one above the other otherwise. */
export const quoteLayout = css({
  display: 'grid',
  gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
  gap: '8',
  alignItems: 'start',
});

/** A source's extracted text to pick a quote from: a region of its own, scrolled with the keyboard too. */
export const sourceText = css({
  maxBlockSize: '32rem',
  overflowY: 'auto',
  marginBlockEnd: '3',
  padding: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  _focusVisible: focusRing,
});

/** A page's or section's label in that text: never part of a selection, so it never lands in a quote. */
export const unitLabel = css({
  fontSize: 'sm',
  fontWeight: 'bold',
  color: 'fg.muted',
  userSelect: 'none',
});

export const unit = css({ marginBlockEnd: '3' });

/** A rating's icon beside its words: it never shrinks, so the words wrap instead. */
export const ratingIcon = css({ flexShrink: '0', display: 'inline-block' });

export const ratingBadge = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2',
  verticalAlign: 'middle',
});

/** A grid cell's link: its rating first, then its state in words. */
export const gridCell = css({ display: 'flex', flexDirection: 'column', gap: '1' });

/** A dashboard queue: its heading with how many wait, then its first items as links. */
export const queue = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  marginBlockEnd: '5',
});

/** A field's own error, under it: in words with a sign, never by colour alone (admin forms §1.2). */
export const fieldError = css({
  display: 'flex',
  gap: '1.5',
  fontWeight: 'bold',
  fontSize: 'sm',
  color: 'fg.default',
});

/** "(optional)" beside a label: what may be left empty is said, rather than starring what may not. */
export const optional = css({ fontWeight: 'normal', color: 'fg.muted' });

/** A form's primary action, left-aligned under its fields, with the "Saved ✓" line beside it (admin forms §1.4). */
export const formActions = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '3',
});

/** An image as it will show, on a checkerboard so transparent parts read as such, within a box of one size. */
export const imageBox = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  inlineSize: '64',
  maxInlineSize: '100%',
  blockSize: '32',
  padding: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  backgroundColor: 'bg.canvas',
  backgroundImage:
    'linear-gradient(45deg, var(--colors-bg-subtle) 25%, transparent 25%), linear-gradient(-45deg, var(--colors-bg-subtle) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--colors-bg-subtle) 75%), linear-gradient(-45deg, transparent 75%, var(--colors-bg-subtle) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
  '& img': { maxInlineSize: '100%', maxBlockSize: '100%', objectFit: 'contain' },
});

/** Where an image may be dropped: dashed, and marked in words while a file is over it. */
export const dropzone = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '3',
  padding: '4',
  maxInlineSize: '32rem',
  borderWidth: '2px',
  borderStyle: 'dashed',
  borderColor: 'border.default',
  borderRadius: 'md',
  '&[data-dragging]': { borderStyle: 'solid', bg: 'bg.subtle' },
});

/** A colour's swatch beside its code, outlined so a pale one still shows its edge. */
export const swatch = css({
  display: 'inline-block',
  inlineSize: '6',
  blockSize: '6',
  flexShrink: '0',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'sm',
  verticalAlign: 'middle',
});

/** A hex code input beside the colour picker. */
export const hexInput = css({
  inlineSize: '8rem',
  minHeight: '11',
  paddingInline: '3',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
  bg: 'bg.canvas',
  color: 'fg.default',
  fontFamily: 'mono',
  fontSize: 'md',
  _focusVisible: focusRing,
  '&[aria-invalid=true]': { borderWidth: '3px' },
});

/**
 * A field of a change request (PLAN R183): its name, what it is now and what it will be, side by side from tablet
 * width, one under the other on a phone.
 */
export const changeRow = css({
  display: 'grid',
  gridTemplateColumns: { base: '1fr', md: 'minmax(0, 2fr) minmax(0, 3fr)' },
  gap: { base: '2', md: '6' },
  paddingBlock: '4',
  borderBlockStartWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
});

/** "Now" in a change's row: the value as it is, read-only. */
export const changeNow = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1',
  overflowWrap: 'anywhere',
});

/** A field's mark once its new value differs from now: in words and a sign, never by colour alone. */
export const changedMark = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '1',
  marginInlineStart: '2',
  paddingInline: '2',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'full',
  fontSize: 'sm',
  fontWeight: 'bold',
});

/** A change's fields in the list of requests: name, before, proposed. */
export const changeTable = css({
  width: '100%',
  borderCollapse: 'collapse',
  marginBlockEnd: '2',
  '& th, & td': {
    textAlign: 'start',
    verticalAlign: 'top',
    paddingInlineEnd: '3',
    paddingBlock: '2',
    borderBlockEndWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border.subtle',
    overflowWrap: 'anywhere',
  },
  '& thead th': { fontSize: 'sm', color: 'fg.muted' },
});

/** A small logo in a list or a change: contained in a box of one size, never stretched. */
export const thumb = css({
  display: 'block',
  inlineSize: '16',
  blockSize: '10',
  objectFit: 'contain',
});

/** The head of a party's page: its logo, then its name and short name. */
export const entityHeader = css({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4',
  marginBlockStart: '6',
  marginBlockEnd: '4',
});

/**
 * A party's mark in a list (PLAN R184, as on the site): its logo, without a frame, contained in a box of one size, or a
 * rounded square of its colour, or nothing; the box is the same either way, so names line up.
 */
export const listThumb = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: '0',
  inlineSize: '10',
  blockSize: '10',
  '& img': { maxInlineSize: '100%', maxBlockSize: '100%', objectFit: 'contain' },
});

/** A party's mark and, under a logo, its colour as a thin line: the name beside it is a link, already underlined. */
export const markColumn = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '1',
  flexShrink: '0',
});

/** The colour line under a logo, as wide as its box; its place is kept under every mark. */
export const markLine = css({ display: 'block', inlineSize: '10', blockSize: '1' });

/**
 * The cell page's bar for its draft (admin forms §2, PLAN R190): kept at the bottom of the window while the draft's
 * part of the page is in view, with the draft's state in words and its two actions.
 */
export const draftBar = css({
  position: 'sticky',
  insetBlockEnd: '0',
  zIndex: '1',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '3',
  marginBlockStart: '6',
  paddingBlock: '3',
  paddingInline: '4',
  borderBlockStartWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  bg: 'bg.default',
  boxShadow: '0 -2px 6px rgba(0, 0, 0, 0.08)',
});

export const draftBarState = css({
  fontWeight: 'bold',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2',
});

/** The block of a page's destructive actions, last on the page (admin forms §1.4): set apart by a rule above it. */
export const dangerZone = css({
  marginBlockStart: '10',
  paddingBlockStart: '6',
  borderBlockStartWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'border.default',
});

/** A setting's switch, its label and "Saved." on one line (admin forms §2, PLAN R193). */
export const switchRow = css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3' });

/** The switch itself: a target of at least 44 px, its track and its state in words. */
export const switchControl = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2',
  minHeight: '44px',
  paddingInline: '2',
  borderRadius: 'md',
  bg: 'transparent',
  borderWidth: '0',
  cursor: 'pointer',
  color: 'fg.default',
  _focusVisible: focusRing,
});

export const switchTrack = css({
  position: 'relative',
  display: 'inline-block',
  width: '44px',
  height: '24px',
  flexShrink: 0,
  borderRadius: 'full',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'fg.default',
  bg: 'bg.subtle',
  '&[data-on]': { bg: 'fg.default' },
});

export const switchThumb = css({
  position: 'absolute',
  insetBlockStart: '2px',
  insetInlineStart: '2px',
  width: '16px',
  height: '16px',
  borderRadius: 'full',
  bg: 'fg.default',
  transition: 'transform 120ms',
  '[data-on] > &': { transform: 'translateX(20px)', bg: 'bg.default' },
});

export const switchState = css({ fontWeight: 'bold', minWidth: '4em', textAlign: 'start' });

/** A value to type or copy (an election's slug in a confirmation): as code, selected whole with one click. */
export const copyableCode = css({
  fontFamily: 'mono',
  paddingInline: '1',
  borderRadius: 'sm',
  bg: 'bg.subtle',
  userSelect: 'all',
});

/** Where an election stands, first on its overview (PLAN R193): bordered, apart from the forms below it. */
export const statusCard = css({
  padding: '4',
  marginBlockEnd: '8',
  borderWidth: '2px',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'md',
});

/** A Markdown text's preview (PLAN R196): as the public site lays it out, inside a bordered box. */
export const markdownPreview = css({
  padding: '4',
  borderWidth: '1px',
  borderStyle: 'dashed',
  borderColor: 'border.default',
  borderRadius: 'md',
  maxWidth: '75ch',
  '& p, & ul, & ol': { marginBlockEnd: '3' },
  '& ul, & ol': { paddingInlineStart: '6' },
  '& ul': { listStyle: 'disc' },
  '& ol': { listStyle: 'decimal' },
  '& h2': { fontSize: 'xl', fontWeight: 'bold', marginBlock: '3' },
  '& h3, & h4, & h5, & h6': { fontWeight: 'bold', marginBlock: '2' },
  '& a': { textDecoration: 'underline' },
});
