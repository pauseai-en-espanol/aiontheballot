import { redirect } from 'next/navigation';
import { cache } from 'react';

import { getFromApi } from './api';
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
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A GET of signed-in data: its body, or undefined when there is nothing there for this user (404, or 400 for a path
 * no tenant or election can have). A session that ended since the page began signs in again; anything else is a
 * fault.
 */
const read = async (path: string): Promise<unknown> => {
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
  throw new Error(`The API answered ${status} for ${path}`);
};

const expect = <T>(value: unknown, keys: readonly string[], what: string): T => {
  if (!isObject(value) || !keys.every((key) => key in value)) {
    throw new Error(`The API's answer for ${what} isn't what the admin expects`);
  }
  return value as T;
};

/** The tenants the user may open (A6), and whether they are a platform admin. */
export const getTenants = cache(
  async (): Promise<{ tenants: TenantSummary[]; platformAdmin: boolean }> =>
    expect(await read('/api/tenants'), ['tenants', 'platformAdmin'], 'the tenants'),
);

const tenantPath = (slug: string) => `/api/t/${encodeURIComponent(slug)}`;

/** A tenant the user may open, or undefined (a 404 page). */
export const getTenant = cache(async (slug: string): Promise<TenantOverview | undefined> => {
  const body = await read(tenantPath(slug));
  return body === undefined ? undefined : expect(body, ['tenant', 'roles'], 'a tenant');
});

export const getMembers = cache(async (slug: string): Promise<MemberList | undefined> => {
  const body = await read(`${tenantPath(slug)}/members`);
  return body === undefined ? undefined : expect(body, ['members', 'canManage'], 'the members');
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
    const body = await read(`${tenantPath(slug)}/documents`);
    return body === undefined ? undefined : expect(body, ['documents', 'canEdit'], 'the texts');
  },
);
