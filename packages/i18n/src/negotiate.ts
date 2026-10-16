import { isLocale, type Locale } from './catalog.js';

/**
 * Which language the admin speaks to someone (editorial workflow §2.7): on its pages, and in the account mail the API
 * sends from them (PLAN R170). No dependencies, so both apps share it.
 */

/** English is the source language (ADR-0003 §6): what a browser asking for neither language gets. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The language someone chose with the admin's switch, kept a year on the admin host only: `__Host-` (Secure, Path=/,
 * no Domain), HttpOnly, SameSite=Lax. A preference, never anything that grants access, and outside Better Auth's
 * `__Host-admin.*` names; the public site sets no cookie at all.
 */
export const LOCALE_COOKIE = '__Host-locale';

/**
 * The language from the browser's Accept-Language, by preference order and quality: the first language it asks for
 * that the admin has, matched on the primary subtag (`es-ES` is `es`).
 */
export const negotiateLocale = (acceptLanguage: string | null | undefined): Locale => {
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [range = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q === undefined ? 1 : Number(q.slice(2));
      return { language: range.trim().toLowerCase().split('-')[0] ?? '', quality, index };
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked.map(({ language }) => language).find(isLocale) ?? DEFAULT_LOCALE;
};

/** The chosen language if there is one, else the browser's (negotiateLocale). */
export const pickLocale = (chosen: string | undefined, acceptLanguage: string | null): Locale =>
  isLocale(chosen) ? chosen : negotiateLocale(acceptLanguage);

/** The language a request to the admin host asks for: its switch's cookie, else its Accept-Language. */
export const requestLocale = (headers: Headers): Locale => {
  const chosen = (headers.get('cookie') ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  return pickLocale(chosen, headers.get('accept-language'));
};
