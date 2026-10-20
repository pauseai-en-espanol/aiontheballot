import { css, cx } from '@styled-system/css';

/** Shared styles of the site's pages. */

export const wrap = css({
  width: '100%',
  maxWidth: '1200px',
  marginInline: 'auto',
  paddingInline: 'clamp(16px, 4vw, 56px)',
});

export const display = css({
  fontFamily: 'display',
  fontWeight: '700',
  textTransform: 'uppercase',
});

export const focusRing = css({
  _focusVisible: { outline: '3px solid', outlineColor: 'currentColor', outlineOffset: '3px' },
});

/** Text the operator wrote, rendered from Markdown: readable measure, spaced blocks, visible links. */
export const prose = css({
  maxWidth: '70ch',
  fontSize: '18px',
  lineHeight: '1.6',
  '& > * + *': { marginTop: '1em' },
  '& h2, & h3, & h4, & h5, & h6': { fontWeight: '700', lineHeight: '1.25', marginTop: '1.6em' },
  '& h2': { fontSize: '26px' },
  '& h3': { fontSize: '22px' },
  '& ul': { listStyle: 'disc', paddingInlineStart: '1.5em' },
  '& ol': { listStyle: 'decimal', paddingInlineStart: '1.5em' },
  '& li + li': { marginTop: '0.4em' },
  '& a': { textDecoration: 'underline', textUnderlineOffset: '3px' },
  '& a:focus-visible': { outline: '3px solid', outlineColor: 'currentColor', outlineOffset: '3px' },
  '& blockquote': {
    borderInlineStart: '4px solid',
    borderColor: 'border.default',
    paddingInlineStart: '1em',
  },
  '& code': { fontFamily: 'monospace' },
});

/** A page's title's letters, in the site's display face, for a title that sets its own spacing. */
export const pageTitleText = cx(
  display,
  css({ fontSize: 'clamp(36px, 5vw, 56px)', lineHeight: '1' }),
);

/** A page's title, in the site's display face. */
export const pageTitle = cx(pageTitleText, css({ marginBottom: '32px' }));
