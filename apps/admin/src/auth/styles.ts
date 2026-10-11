import { css } from '@styled-system/css';

/** The sign-in screens' look: one narrow column, the preset's colours by role, 44px controls (WCAG 2.2 AA). */

const focusRing = {
  outline: '3px solid',
  outlineColor: 'fg.default',
  outlineOffset: '2px',
} as const;

export const page = css({
  maxWidth: '28rem',
  marginInline: 'auto',
  paddingInline: '4',
  paddingBlock: { base: '10', md: '16' },
});

export const heading = css({
  fontSize: '2xl',
  fontWeight: 'bold',
  lineHeight: 'tight',
  marginBlockEnd: '3',
  _focusVisible: focusRing,
});

export const subheading = css({ fontSize: 'xl', fontWeight: 'bold', marginBlockEnd: '2' });

export const text = css({ color: 'fg.muted', marginBlockEnd: '6' });

export const form = css({ display: 'flex', flexDirection: 'column', gap: '5' });

export const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5' });

export const label = css({ fontWeight: 'bold' });

export const hint = css({ color: 'fg.muted', fontSize: 'sm' });

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

export const codeInput = css({ fontFamily: 'mono', letterSpacing: '0.2em', fontSize: 'lg' });

export const button = css({
  minHeight: '11',
  paddingInline: '5',
  borderRadius: 'md',
  bg: 'bg.accent',
  color: 'fg.onAccent',
  fontWeight: 'bold',
  cursor: 'pointer',
  _focusVisible: focusRing,
  _disabled: { cursor: 'progress', opacity: 0.7 },
});

/** A secondary action that reads as a link but acts in place. */
export const textButton = css({
  alignSelf: 'flex-start',
  minHeight: '6',
  padding: '0',
  bg: 'transparent',
  color: 'fg.default',
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
  cursor: 'pointer',
  _focusVisible: focusRing,
});

export const link = css({
  color: 'fg.default',
  textDecoration: 'underline',
  textUnderlineOffset: '0.2em',
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

export const qr = css({
  width: '12rem',
  height: '12rem',
  padding: '2',
  bg: 'bg.canvas',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'border.subtle',
  '& svg': { width: '100%', height: '100%' },
});

export const secret = css({
  fontFamily: 'mono',
  fontSize: 'md',
  wordBreak: 'break-all',
  padding: '2',
  bg: 'bg.subtle',
  borderRadius: 'md',
});

export const codes = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '2',
  fontFamily: 'mono',
  fontSize: 'md',
  padding: '3',
  bg: 'bg.subtle',
  borderRadius: 'md',
  listStyle: 'none',
});

export const footnote = css({ marginBlockStart: '6' });

export const list = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2',
  marginBlockEnd: '6',
  paddingInlineStart: '5',
  listStyle: 'disc',
});
