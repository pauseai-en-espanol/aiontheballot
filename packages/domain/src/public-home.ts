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
    /** The operator's own newsletter, never a list of ours. Not shown until there is a real notify list (PLAN R82). */
    newsletterUrl: string | null;
    /** The legal notice's fields (BRIEF §3 invariant 3; LSSI art. 10), as the operator's row holds them. */
    legalName: string;
    taxId: string | null;
    address: string | null;
    registryEntry: string | null;
    privacyEmail: string | null;
  };
  /** The latest published version of each policy text the operator has published. */
  documents: Readonly<Partial<Record<TenantDocumentKind, PublicDocument>>>;
  /**
   * Whether the coming-soon page offers the signup list (PLAN R119): the API can send mail and the site has a
   * published privacy policy, which the form links to.
   */
  signups: boolean;
  /** The next election the public may see: the soonest one not archived whose date hasn't passed, if any. */
  election: { name: Localized; date: string | null } | null;
  /**
   * The site's public elections (live or archived), the current one first: the soonest live one, then the other live
   * ones, then the archived ones, the most recent first. An open site's home leads to the first (public-site spec §3.2).
   */
  elections: readonly PublicElectionSummary[];
  /**
   * The tenant's brand images by slot (`operator_logo_on_accent`, `operator_logo_on_canvas`…): an upload of the
   * tenant's or a platform asset, named by the SHA-256 of its bytes.
   */
  brand: Readonly<Record<string, BrandImage>>;
}

export interface PublicElectionSummary {
  slug: string;
  name: Localized;
  /** `YYYY-MM-DD`. */
  date: string | null;
  status: 'live' | 'archived';
}

export type TenantDocumentKind = 'privacy_policy' | 'right_of_reply_policy' | 'about_operator';

export interface PublicDocument {
  /** Markdown, rendered and sanitized by the public site. */
  body: Localized;
  version: number;
  /** An ISO 8601 instant. */
  publishedAt: string;
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
