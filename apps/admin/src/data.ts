import type { SiteTheme } from '@aiontheballot/domain/site-theme';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { getFromApi } from './api';
import { confirmPath } from './auth/confirm';
import { forwardedRequest } from './session';

/**
 * The admin's reads of the API's signed-in data (ADR-0003 §1), from server components, with the browser's cookie. The
 * API reads it all under RLS (ADR-0002); these shapes only say what the pages expect. Each read is made once per
 * request (`cache`), however many components ask.
 */

export type TenantRole = 'country_admin' | 'editor' | 'reviewer';
export const TENANT_ROLES: readonly TenantRole[] = ['country_admin', 'editor', 'reviewer'];

export type Localized = Readonly<Record<string, string>>;

export interface TenantSummary {
  slug: string;
  name: Localized;
  defaultLocale: string;
}

export interface TenantOverview {
  tenant: TenantSummary & {
    enabledLocales: string[];
    countryCode: string;
    methodologyKind: 'demands' | 'descriptive';
    active: boolean;
    reportRetentionDays: number;
    liveEditsNeedSecondApprover: boolean;
    /** The site's own colours (T1, PLAN R178); absent from an older API's answer. */
    theme?: SiteTheme;
  };
  roles: TenantRole[];
  platformAdmin: boolean;
}

export interface Member {
  userId: string;
  /** Null for an account that no longer exists. */
  name: string | null;
  /** Only for country admins and platform admins (A7.1); null for an account that no longer exists. */
  email?: string | null;
  roles: TenantRole[];
}

export interface MemberList {
  members: Member[];
  canManage: boolean;
  emailsShown: boolean;
  /** Whether the API can send password reset emails (PLAN R170); an API from before them doesn't say. */
  resetReady?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A GET of signed-in data: its body, or undefined when there is nothing there for this user (404, or 400 for a path
 * no tenant or election can have). A session that ended since the page began signs in again; anything else is a
 * fault.
 */
export const readApi = async (path: string): Promise<unknown> => {
  const { status, body } = await getFromApi(path, await forwardedRequest());
  if (status === 200) {
    return body;
  }
  if (status === 404 || status === 400) {
    return undefined;
  }
  if (status === 401) {
    redirect('/sign-in');
  }
  // One of the riskiest actions (PLAN D23) whose page didn't ask to confirm first, as an audit log's does: the
  // second factor got older than 12 hours meanwhile. Confirmed, the person starts again from the home page.
  if (status === 403 && isObject(body) && body.error === 'stepUp') {
    redirect(confirmPath('/'));
  }
  throw new Error(`The API answered ${status} for ${path}`);
};

const expect = <T>(value: unknown, keys: readonly string[], what: string): T => {
  if (!isObject(value) || !keys.every((key) => key in value)) {
    throw new Error(`The API's answer for ${what} isn't what the admin expects`);
  }
  return value as T;
};

/** One of the member's tokens for tools (ADR-0008), never the token itself, which is shown once when minted. */
export interface TokenSummary {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface TokenList {
  tokens: TokenSummary[];
  maxDays: number;
  maxActive: number;
}

/** The member's tokens for tools; undefined from an API that has none yet. */
export const getTokens = cache(async (): Promise<TokenList | undefined> => {
  const body = await readApi('/api/tokens');
  return body === undefined
    ? undefined
    : expect(body, ['tokens', 'maxDays', 'maxActive'], 'the tokens');
});

/** One of the member's passkeys (PLAN D22), as the passkeys page lists it: never its key. */
export interface Passkey {
  id: string;
  name: string | null;
  /** Where it is kept ("1Password"), when the device said and the API knows it. */
  provider: string | null;
  /** Whether it travels between the person's devices (a password manager's or a platform's sync). */
  synced: boolean;
  createdAt: string | null;
}

/** The member's passkeys; undefined from an API that has none yet. */
export const getPasskeys = cache(async (): Promise<Passkey[] | undefined> => {
  const body = await readApi('/api/passkeys');
  return body === undefined
    ? undefined
    : expect<{ passkeys: Passkey[] }>(body, ['passkeys'], 'the passkeys').passkeys;
});

/** The tenants the user may open (A6), and whether they are a platform admin. */
export const getTenants = cache(
  async (): Promise<{ tenants: TenantSummary[]; platformAdmin: boolean }> =>
    expect(await readApi('/api/tenants'), ['tenants', 'platformAdmin'], 'the tenants'),
);

export const tenantPath = (slug: string) => `/api/t/${encodeURIComponent(slug)}`;

/** A tenant the user may open, or undefined (a 404 page). */
export const getTenant = cache(async (slug: string): Promise<TenantOverview | undefined> => {
  const body = await readApi(tenantPath(slug));
  return body === undefined ? undefined : expect(body, ['tenant', 'roles'], 'a tenant');
});

export const getMembers = cache(async (slug: string): Promise<MemberList | undefined> => {
  const body = await readApi(`${tenantPath(slug)}/members`);
  return body === undefined ? undefined : expect(body, ['members', 'canManage'], 'the members');
});

/** An invitation, as its tenant's country admins and platform admins see it (editorial workflow A2). */
export interface Invitation {
  id: string;
  email: string;
  role: TenantRole;
  createdAt: string;
  expiresAt: string;
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
}

/** The tenant's invitations, whether the user may invite, and whether the deployment can send them. */
export const getInvitations = cache(
  async (
    slug: string,
  ): Promise<
    { invitations: Invitation[]; canInvite: boolean; mailReady: boolean; days: number } | undefined
  > => {
    const body = await readApi(`${tenantPath(slug)}/invitations`);
    return body === undefined
      ? undefined
      : expect(body, ['invitations', 'canInvite', 'mailReady'], 'the invitations');
  },
);

/** A site's signup list in numbers (PLAN R119): what country admins and platform admins see, never an address. */
export interface SignupCounts {
  unconfirmed: number;
  confirmed: number;
  futureElections: number;
}

export const getSignupCounts = cache(async (slug: string): Promise<SignupCounts | undefined> => {
  const body = await readApi(`${tenantPath(slug)}/signups`);
  return body === undefined
    ? undefined
    : expect(body, ['unconfirmed', 'confirmed', 'futureElections'], 'the signup counts');
});

/** Whether the user may do what any of `roles` may in the tenant (platform admins may do all): for what to offer. */
export const mayAct = (overview: TenantOverview, ...roles: TenantRole[]): boolean =>
  overview.platformAdmin || overview.roles.some((role) => roles.includes(role));

/** The operator's texts (editorial workflow T2). */
export const DOCUMENT_KINDS = [
  'privacy_policy',
  'right_of_reply_policy',
  'about_operator',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentVersion {
  id: string;
  kind: DocumentKind;
  version: number;
  body: Localized;
  /** Null while a draft. */
  publishedAt: string | null;
  createdAt: string;
}

/** Every version of the tenant's texts, newest first in each kind, and whether the user may write them. */
export const getDocuments = cache(
  async (slug: string): Promise<{ documents: DocumentVersion[]; canEdit: boolean } | undefined> => {
    const body = await readApi(`${tenantPath(slug)}/documents`);
    return body === undefined ? undefined : expect(body, ['documents', 'canEdit'], 'the texts');
  },
);

/** A slot of a site's brand images (admin forms §2, settings; PLAN R195). */
export interface BrandSlot {
  slot: string;
  /** The site's own upload, shown at `/api/t/{tenant}/images/{id}`. */
  file: { id: string; contentType: string } | null;
  /** An image of the platform's the slot names. */
  asset: { name: string } | null;
}

/** The site's brand images, slot by slot, and whether this member may change them. */
export const getBrand = cache(
  async (slug: string): Promise<{ slots: BrandSlot[]; canEdit: boolean } | undefined> => {
    const body = await readApi(`${tenantPath(slug)}/brand`);
    return body === undefined ? undefined : expect(body, ['slots', 'canEdit'], 'the brand images');
  },
);

/** A site an organization runs (`operator`) or endorses (editorial workflow P2). */
export interface OrganizationLink {
  slug: string;
  name: Localized;
  role: 'operator' | 'endorser';
}

export interface OrganizationSummary {
  id: string;
  displayName: Localized;
  legalName: string;
  isPauseaiChapter: boolean;
  tenants: OrganizationLink[];
}

export interface Organization extends OrganizationSummary {
  taxId: string | null;
  address: string | null;
  registryEntry: string | null;
  contactEmail: string | null;
  privacyEmail: string | null;
  url: string | null;
  newsletterUrl: string | null;
  /** Whether it has a logo (PLAN R195), shown at `/api/organizations/{id}/logo`. */
  hasLogo: boolean;
}

/** Every organization, for platform admins (anyone else gets undefined: a 404), and the languages names may be in. */
export const getOrganizations = cache(
  async (): Promise<{ organizations: OrganizationSummary[]; languages: string[] } | undefined> => {
    const body = await readApi('/api/organizations');
    return body === undefined
      ? undefined
      : expect(body, ['organizations', 'languages'], 'the organizations');
  },
);

/** One organization, for platform admins, and the languages its name may be in. */
export const getOrganization = cache(
  async (id: string): Promise<{ organization: Organization; languages: string[] } | undefined> => {
    const body = await readApi(`/api/organizations/${encodeURIComponent(id)}`);
    return body === undefined
      ? undefined
      : expect(body, ['organization', 'languages'], 'an organization');
  },
);

export interface SiteHostname {
  hostname: string;
  canonical: boolean;
  verified: boolean;
  retired: boolean;
}

export interface SiteSummary {
  slug: string;
  name: Localized;
  defaultLocale: string;
  countryCode: string;
  active: boolean;
  hostnames: SiteHostname[];
}

export interface Site extends SiteSummary {
  enabledLocales: string[];
  methodologyKind: 'demands' | 'descriptive';
  reportRetentionDays: number;
  operator: { id: string; name: Localized; legalName: string } | null;
  /** Its public settings (PLAN R135): open or coming soon, indexed by search engines, its Plausible script. */
  open: boolean;
  indexed: boolean;
  plausibleScript: string | null;
}

/** Every site, for platform admins (PLAN R129), and the organizations that could run a new one. */
export const getSites = cache(
  async (): Promise<
    | {
        sites: SiteSummary[];
        organizations: { id: string; displayName: Localized; legalName: string }[];
      }
    | undefined
  > => {
    const body = await readApi('/api/sites');
    return body === undefined ? undefined : expect(body, ['sites', 'organizations'], 'the sites');
  },
);

/** One site, for platform admins. */
export const getSite = cache(async (slug: string): Promise<{ site: Site } | undefined> => {
  const body = await readApi(`/api/sites/${encodeURIComponent(slug)}`);
  return body === undefined ? undefined : expect(body, ['site'], 'a site');
});
