import type { Localized } from './localized.js';
import type { MethodologyKind } from './methodology.js';

/**
 * What a tenant's home shows while its site is coming soon, as the API serves it at GET /public/tenants/{slug}/home.
 * Read as aiontheballot_web, so it holds only what RLS makes public.
 */
export interface PublicHome {
  tenant: { displayName: Localized; defaultLocale: string; methodologyKind: MethodologyKind };
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
}
