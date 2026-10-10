import type { Localized } from './localized.js';
import type { MethodologyKind } from './methodology.js';

/**
 * What a tenant's home shows while its site is coming soon, as the API serves it at GET /public/tenants/{slug}/home.
 * Read as aiontheballot_web, so it holds only what RLS makes public.
 */
export interface PublicHome {
  tenant: {
    displayName: Localized;
    defaultLocale: string;
    /** ISO 3166-1, for og:locale (`es_ES`). */
    countryCode: string;
    methodologyKind: MethodologyKind;
  };
  /** Every active tenant has an operator (a deferred check in the database). */
  operator: {
    displayName: Localized;
    url: string | null;
    contactEmail: string | null;
    /** Where people sign up to hear when the site is published: the operator's own list, never ours. */
    newsletterUrl: string | null;
  };
  /** The next election the public may see: the soonest one not archived whose date hasn't passed, if any. */
  election: { name: Localized; date: string | null } | null;
  /**
   * The tenant's brand images by slot (`operator_logo_on_accent`, `operator_logo_on_canvas`…): an upload of the
   * tenant's or a platform asset, named by the SHA-256 of its bytes.
   */
  brand: Readonly<Record<string, BrandImage>>;
}

export interface BrandImage {
  sha256: string;
  contentType: string;
}

/**
 * The brand slots the public pages use: the operator's logos, each for the background it sits on, its mark, and the
 * tenant's own site icon (a square PNG of at least 512 px; without one, the platform's default icon).
 */
export const BRAND_SLOTS = {
  operatorLogoOnAccent: 'operator_logo_on_accent',
  operatorLogoOnCanvas: 'operator_logo_on_canvas',
  operatorLogoOnInverse: 'operator_logo_on_inverse',
  operatorMark: 'operator_mark',
  siteIcon: 'site_icon',
} as const;
