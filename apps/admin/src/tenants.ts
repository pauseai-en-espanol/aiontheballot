import { getFromApi } from './api';
import { forwardedRequest } from './session';

export interface TenantSummary {
  slug: string;
  name: Record<string, string>;
  defaultLocale: string;
}

const isTenantList = (value: unknown): value is { tenants: TenantSummary[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { tenants?: unknown }).tenants);

/** The tenants the signed-in user may open (editorial workflow A6), as the API reads them under RLS. */
export const listTenants = async (): Promise<TenantSummary[]> => {
  const { status, body } = await getFromApi('/api/tenants', await forwardedRequest());
  if (status !== 200 || !isTenantList(body)) {
    throw new Error(`The API answered ${status} for the tenants`);
  }
  return body.tenants;
};

/** A tenant's name in the admin's language, else in the tenant's own. */
export const tenantName = (tenant: TenantSummary, locale: string): string =>
  tenant.name[locale] ?? tenant.name[tenant.defaultLocale] ?? tenant.slug;
