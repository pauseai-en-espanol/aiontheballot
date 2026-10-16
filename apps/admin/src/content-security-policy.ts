/**
 * The admin's Content Security Policy (ADR-0003: nonces in the admin, never on the cached public site). Every admin
 * page is rendered per request, so each gets a nonce of its own: Next reads it from this header on the request and
 * puts it on its scripts, and 'strict-dynamic' lets those load the rest of the app's chunks. No other script runs,
 * inline or from anywhere, so injected markup can't run code where members are signed in. Styles allow inline: the
 * components' server-rendered style attributes can't carry a nonce. Nothing loads from another host, no frame may hold
 * a page (the sign-in page included), and a form posts only to the admin. Images may also be `blob:` URLs, which only
 * the page's own scripts make: an image field's preview of a file before it is uploaded (admin forms §1.1). `pnpm dev`
 * alone adds 'unsafe-eval', which React's development build needs; a production build never has it.
 */
export const contentSecurityPolicy = (nonce: string, development = false): string =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
  ].join('; ');

/** A nonce: 128 random bits, base64, new for every request. */
export const newNonce = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
