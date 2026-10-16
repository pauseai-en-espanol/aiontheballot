import type { Localized } from './data';

/** Content and the language it is in. */
export interface InLanguage {
  text: string;
  lang: string;
}

/**
 * Content in the admin's language where it has it, else in the tenant's default language, else in any it has, with
 * that language, so the page can mark it (WCAG 3.1.2, language of parts). Blank text counts as missing.
 */
export const inLanguage = (
  value: Localized,
  locale: string,
  defaultLocale: string,
): InLanguage | undefined => {
  for (const lang of [locale, defaultLocale, ...Object.keys(value)]) {
    const text = value[lang]?.trim();
    if (text) {
      return { text, lang };
    }
  }
  return undefined;
};

/** A tenant's name as `inLanguage` picks it, else its slug. */
export const siteName = (
  tenant: { slug: string; name: Localized; defaultLocale: string },
  locale: string,
): InLanguage =>
  inLanguage(tenant.name, locale, tenant.defaultLocale) ?? { text: tenant.slug, lang: locale };

/** An organization's name as `inLanguage` picks it (it has no default language of its own), else its legal name. */
export const organizationName = (
  organization: { displayName: Localized; legalName: string },
  locale: string,
): InLanguage =>
  inLanguage(organization.displayName, locale, locale) ?? {
    text: organization.legalName,
    lang: locale,
  };

/** A site's name as an organization's page shows it: in the admin's language where it has it, else its slug. */
export const linkedSiteName = (
  site: { slug: string; name: Localized },
  locale: string,
): InLanguage => inLanguage(site.name, locale, locale) ?? { text: site.slug, lang: locale };
