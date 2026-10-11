import { isLocale, type Locale } from '@aiontheballot/i18n/catalog';
import { cookies, headers } from 'next/headers';

/** English is the source language (ADR-0003 §6): what a browser asking for neither language gets. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The admin's language from the browser's Accept-Language (editorial workflow §2.7), by preference order and quality:
 * the first language it asks for that the admin has, matched on the primary subtag (`es-ES` is `es`).
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

/**
 * The language someone chose with the admin's switch (editorial workflow §2.7), kept a year on the admin host only:
 * `__Host-` (Secure, Path=/, no Domain), HttpOnly, SameSite=Lax. A preference, never anything that grants access, and
 * outside Better Auth's `__Host-admin.*` names; the public site sets no cookie at all.
 */
export const LOCALE_COOKIE = '__Host-locale';

/** The chosen language if there is one, else the browser's (negotiateLocale). */
export const pickLocale = (chosen: string | undefined, acceptLanguage: string | null): Locale =>
  isLocale(chosen) ? chosen : negotiateLocale(acceptLanguage);

export const getLocale = async (): Promise<Locale> =>
  pickLocale((await cookies()).get(LOCALE_COOKIE)?.value, (await headers()).get('accept-language'));

// A path's own characters and well-formed escapes only (RFC 3986), so nothing a browser drops or rewrites when it reads
// a Location (tabs, newlines, backslashes) can turn it into `//another-host`, and nothing a header can't carry gets that
// far.
const PATH = /^\/(?!\/)(?:[\w\-.~!$&'()*+,;=:@/]|%[\da-f]{2})*$/i;
const MAX_PATH = 2048;

/** Where to go back to: a path on this host only, never another site (`//host`, `/\host`). */
export const backTo = (value: unknown): string =>
  typeof value === 'string' && value.length <= MAX_PATH && PATH.test(value) ? value : '/';
