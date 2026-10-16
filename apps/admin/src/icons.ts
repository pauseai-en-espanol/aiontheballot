/**
 * The admin's icons (PLAN R154): the platform's default site icon, the one the public site shows for a site without
 * its own, drawn at build time by the share images' renderer. The root layout names them; /favicon.ico and
 * /apple-touch-icon.png also answer the clients that ask for them by name.
 */
export const ADMIN_ICONS = {
  icon: '/icon-32.png',
  shortcut: '/favicon.ico',
  apple: '/apple-touch-icon.png',
} as const;

/** A day: the names carry no hash, so a new drawing must be able to replace them. */
const A_DAY = 'public, max-age=86400';

export const iconResponse = (bytes: Uint8Array, type: 'image/png' | 'image/x-icon'): Response =>
  new Response(bytes.slice().buffer, {
    headers: {
      'content-type': type,
      'content-length': String(bytes.byteLength),
      'cache-control': A_DAY,
    },
  });
