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
  /** Editor in A, reviewer in B. */
  editorAReviewerB: user(6),
  countryAdminB: user(8),
  /** No membership: the matrix's insert cases give it one. */
  newcomer: user(10),
} as const;

/** Tenant A (`test-a`): its members are the editor, the reviewer, the country admin and editorAReviewerB. */
export const TENANT_A = '0190f8c4-0000-7000-8000-00000000000a';

/** Tenant A's live election (two parties, two criteria) and its three cells, and its draft election (no cells). */
export const LIVE_A = {
  id: fixture(7, 1),
  slug: 'generales-de-ejemplo',
  cells: { draft: fixture(9, 51), inReview: fixture(9, 52), published: fixture(9, 63) },
  publishedRating: 'partially_meets',
} as const;
export const DRAFT_A = { slug: 'autonomicas-de-ejemplo' } as const;
export const LIVE_B = { id: fixture(7, 5) } as const;

/** A's elections of every kind, each with a methodology, a reviewer, two parties and two criteria, but the empty one. */
const election = (n: number, slug: string) => ({
  id: fixture(7, n),
  slug,
  methodology: fixture(8, n),
  reviewer: fixture(9, n),
  parties: [fixture(7, 20 + n), fixture(7, 40 + n)],
  criteria: [fixture(8, 20 + n), fixture(8, 40 + n)],
});
export const ELECTIONS_A = {
  live: election(1, 'generales-de-ejemplo'),
  /** Regional (XA-01) and announced. */
  draft: election(2, 'autonomicas-de-ejemplo'),
  archived: election(3, 'europeas-de-ejemplo'),
  /** A municipal draft with no structure at all. */
  empty: election(4, 'municipales-de-ejemplo'),
  /** In preview, announced (PLAN R181): its first party has a logo. */
  preview: election(12, 'consulta-de-ejemplo'),
} as const;

/** A's operator, which its demands methodologies name. */
export const OPERATOR_A = fixture(3, 1);

/** An organization no tenant links to: only platform admins see it. */
export const UNLINKED_ORGANIZATION = fixture(3, 4);

/** A fictional brand asset every tenant may select. */
export const SHARED_BRAND_ASSET = fixture(4, 1);
