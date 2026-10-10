import type { ComingSoonCard } from '@aiontheballot/og/coming-soon';

import { pickLocalized } from '@aiontheballot/domain/localized';
import { BRAND_SLOTS, type PublicHome } from '@aiontheballot/domain/public-home';
import { getTranslator, type Locale } from '@aiontheballot/i18n/messages';
import { cardHash } from '@aiontheballot/og/hash';
import { isShareSize, type ShareSize } from '@aiontheballot/og/sizes';

/**
 * The views people share, each with its own image template. Only the home exists while the site is coming soon;
 * the overview, party, criterion and cell views join with the public site (PLAN, social sharing).
 */
export const SHARE_TEMPLATES = ['home'] as const;
export type ShareTemplate = (typeof SHARE_TEMPLATES)[number];

/** A page's address: the tenant's canonical base, the locale unless it's the default, then the path. */
export const pageUrl = (base: string, locale: string, defaultLocale: string, path = ''): string =>
  `${base}${locale === defaultLocale ? '' : `/${locale}`}${path}`;

/** Where an image lives, relative to its page's locale root: `/og/home.1200x630.0123456789ab.png`. */
export const imagePath = (template: ShareTemplate, size: ShareSize, hash: string): string =>
  `/og/${template}.${size}.${hash}.png`;

export const parseImageFile = (
  file: string,
): { template: ShareTemplate; size: ShareSize; hash: string } | undefined => {
  const match = /^([a-z]+)\.(\d+x\d+)\.([0-9a-f]{12})\.png$/.exec(file);
  const [, template, size, hash] = match ?? [];
  if (
    !(SHARE_TEMPLATES as readonly string[]).includes(template ?? '') ||
    !isShareSize(size) ||
    !hash
  ) {
    return undefined;
  }
  return { template: template as ShareTemplate, size, hash };
};

/** og:locale: the language and the tenant's country, `es_ES`. */
export const ogLocale = (locale: string, countryCode: string): string => `${locale}_${countryCode}`;

/** The coming-soon card's content: every text from the tenant's data and the messages, the address from the base. */
export const homeCardContent = (home: PublicHome, locale: Locale, base: string): ComingSoonCard => {
  const t = getTranslator(locale);
  const local = (value: PublicHome['tenant']['displayName']) =>
    pickLocalized(value, locale, home.tenant.defaultLocale) ?? '';
  const { election } = home;
  // satori draws PNG and JPEG; a WebP logo leaves the operator line in words.
  const logo = home.brand[BRAND_SLOTS.operatorLogoOnAccent];
  const drawable =
    logo && ['image/png', 'image/jpeg'].includes(logo.contentType) ? logo : undefined;
  const electionText =
    election &&
    (election.date
      ? t('home.election', {
          name: local(election.name),
          date: new Date(`${election.date}T12:00:00Z`),
        })
      : local(election.name));
  return {
    label: electionText ? `${t('home.comingSoon')} · ${electionText}` : t('home.comingSoon'),
    name: local(home.tenant.displayName),
    question: t('home.question'),
    address: base.replace(/^https:\/\//, ''),
    initiative: t('layout.initiativeOf', { operator: local(home.operator.displayName) }),
    initiativeLead: t('layout.initiativeLead'),
    ...(drawable
      ? { operatorLogo: { sha256: drawable.sha256, contentType: drawable.contentType } }
      : {}),
  };
};

/** The image's content hash: it changes whenever anything on the card does. */
export const homeCardHash = (card: ComingSoonCard, size: ShareSize): string =>
  cardHash('home', size, card);
