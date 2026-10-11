import { isLocale, type Locale } from '@aiontheballot/i18n/catalog';
import { headers } from 'next/headers';

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

export const getLocale = async (): Promise<Locale> =>
  negotiateLocale((await headers()).get('accept-language'));
