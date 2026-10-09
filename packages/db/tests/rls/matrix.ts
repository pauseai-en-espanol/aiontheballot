import type { Principal } from './harness.js';

/**
 * The tenant-isolation matrix (ADR-0002, test matrix). Every table and view in `app` must have an entry, or the
 * completeness test fails; M1 fills it in as the tables arrive. Fixture ids are fictional.
 */

export const TENANT_A = '0190f8c4-0000-7000-8000-00000000000a';
export const TENANT_B = '0190f8c4-0000-7000-8000-00000000000b';

const user = (n: number): string =>
  `0190f8c4-0000-7000-8000-0000000001${n.toString().padStart(2, '0')}`;

export const USERS = {
  noMembership: user(1),
  editorA: user(2),
  reviewerA: user(3),
  countryAdminA: user(4),
  platformAdmin: user(5),
  editorAReviewerB: user(6),
  revokedA: user(7),
} as const;

export const PRINCIPALS: readonly Principal[] = [
  { id: 'public', role: 'aiontheballot_web' },
  { id: 'admin role, no actor', role: 'aiontheballot_admin' },
  { id: 'no membership aal2', role: 'aiontheballot_admin', userId: USERS.noMembership, aal: 2 },
  { id: 'editor@A aal2', role: 'aiontheballot_admin', userId: USERS.editorA, aal: 2 },
  { id: 'editor@A aal1', role: 'aiontheballot_admin', userId: USERS.editorA, aal: 1 },
  { id: 'reviewer@A aal2', role: 'aiontheballot_admin', userId: USERS.reviewerA, aal: 2 },
  { id: 'reviewer@A aal1', role: 'aiontheballot_admin', userId: USERS.reviewerA, aal: 1 },
  { id: 'country_admin@A aal2', role: 'aiontheballot_admin', userId: USERS.countryAdminA, aal: 2 },
  { id: 'country_admin@A aal1', role: 'aiontheballot_admin', userId: USERS.countryAdminA, aal: 1 },
  { id: 'platform_admin aal2', role: 'aiontheballot_admin', userId: USERS.platformAdmin, aal: 2 },
  { id: 'platform_admin aal1', role: 'aiontheballot_admin', userId: USERS.platformAdmin, aal: 1 },
  {
    id: 'editor@A + reviewer@B aal2',
    role: 'aiontheballot_admin',
    userId: USERS.editorAReviewerB,
    aal: 2,
  },
  { id: 'revoked member of A aal2', role: 'aiontheballot_admin', userId: USERS.revokedA, aal: 2 },
  { id: 'worker for A', role: 'aiontheballot_worker', jobTenantId: TENANT_A },
];

/** Relation name (`schema.name`) → its expectations. Empty until M1 adds tables. */
export const RELATIONS: Readonly<Record<string, unknown>> = {};
