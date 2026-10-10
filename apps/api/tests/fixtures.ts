/**
 * The ids of the matrix fixtures that @aiontheballot/db's database tests load into aiontheballot_test before these
 * run (packages/db/tests/rls/matrix.ts, where they are defined). Fictional, like all fixtures.
 */
const user = (n: number) => `0190f8c4-0000-7000-8000-0000000001${n.toString().padStart(2, '0')}`;
const fixture = (block: number, n: number) =>
  `0190f8c4-0000-7000-8000-000000000${block}${n.toString().padStart(2, '0')}`;

export const USERS = {
  noMembership: user(1),
  editorA: user(2),
  reviewerA: user(3),
  countryAdminA: user(4),
  platformAdmin: user(5),
  countryAdminB: user(8),
} as const;

/** Tenant A's live election (two parties, two criteria) and its three cells, and its draft election (no cells). */
export const LIVE_A = {
  id: fixture(7, 1),
  slug: 'generales-de-ejemplo',
  cells: { draft: fixture(9, 51), inReview: fixture(9, 52), published: fixture(9, 63) },
  publishedRating: 'partially_meets',
} as const;
export const DRAFT_A = { slug: 'autonomicas-de-ejemplo' } as const;
export const LIVE_B = { id: fixture(7, 5) } as const;
