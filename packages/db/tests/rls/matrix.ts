import type { Principal } from './harness.js';

/**
 * The tenant-isolation matrix (ADR-0002, test matrix). Every table and view in `app` has an entry, or the completeness
 * test fails. Each entry lists fixture rows, the operations tried on them, and who may perform each operation; the
 * cases (every principal × row × operation) are generated from it, and anyone not named in a rule must be denied.
 * Fixture ids and names are fictional.
 */

export const TENANT_A = '0190f8c4-0000-7000-8000-00000000000a';
export const TENANT_B = '0190f8c4-0000-7000-8000-00000000000b';
export const TENANT_INACTIVE = '0190f8c4-0000-7000-8000-00000000000c';

export type TenantKey = 'A' | 'B' | 'inactive';
export type TenantRole = 'country_admin' | 'editor' | 'reviewer';
export const ALL_ROLES: readonly TenantRole[] = ['country_admin', 'editor', 'reviewer'];

/** Two active tenants and one inactive one (ADR-0002, fixtures). */
export const TENANTS: Readonly<Record<TenantKey, { id: string; slug: string; active: boolean }>> = {
  A: { id: TENANT_A, slug: 'test-a', active: true },
  B: { id: TENANT_B, slug: 'test-b', active: true },
  inactive: { id: TENANT_INACTIVE, slug: 'test-inactive', active: false },
};

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
  /** Fixture members of B and of the inactive tenant, so those tenants have rows to target. Not principals. */
  countryAdminB: user(8),
  countryAdminInactive: user(9),
  /** A user who gets a membership in the insert cases. */
  newcomer: user(10),
} as const;

export const MEMBERSHIPS: readonly { user: string; tenant: TenantKey; role: TenantRole }[] = [
  { user: USERS.editorA, tenant: 'A', role: 'editor' },
  { user: USERS.reviewerA, tenant: 'A', role: 'reviewer' },
  { user: USERS.countryAdminA, tenant: 'A', role: 'country_admin' },
  { user: USERS.editorAReviewerB, tenant: 'A', role: 'editor' },
  { user: USERS.editorAReviewerB, tenant: 'B', role: 'reviewer' },
  { user: USERS.countryAdminB, tenant: 'B', role: 'country_admin' },
  { user: USERS.countryAdminInactive, tenant: 'inactive', role: 'country_admin' },
];

/** The raw tokens of the fixture invitations (only their SHA-256 is stored), one pending per tenant. */
export const INVITATION_TOKENS: Readonly<Record<TenantKey, string>> = {
  A: 'token-de-prueba-a',
  B: 'token-de-prueba-b',
  inactive: 'token-de-prueba-inactivo',
};
export const REVOKED_INVITATION_TOKEN = 'token-de-prueba-revocado-a';

/** Fictional hostnames (the .test TLD is reserved). */
export const PLATFORM_HOSTNAME = 'admin.plataforma.test';
export const TOMBSTONE_HOSTNAME = 'purgado.example.test';
export const HOSTNAMES: readonly {
  hostname: string;
  tenant: TenantKey;
  canonical: boolean;
  verified: boolean;
  retired: boolean;
}[] = [
  { hostname: 'test-a.example.test', tenant: 'A', canonical: true, verified: true, retired: false },
  {
    hostname: 'pendiente-a.example.test',
    tenant: 'A',
    canonical: false,
    verified: false,
    retired: false,
  },
  {
    hostname: 'antiguo-a.example.test',
    tenant: 'A',
    canonical: false,
    verified: true,
    retired: true,
  },
  { hostname: 'test-b.example.test', tenant: 'B', canonical: true, verified: true, retired: false },
  {
    hostname: 'test-inactivo.example.test',
    tenant: 'inactive',
    canonical: true,
    verified: true,
    retired: false,
  },
];
/** The fixture hostname with a pending DNS verification. */
export const VERIFYING_HOSTNAME = 'pendiente-a.example.test';

const fixtureId = (block: number, n: number): string =>
  `0190f8c4-0000-7000-8000-000000000${block}${n.toString().padStart(2, '0')}`;

/** Fictional organizations: the operator of each tenant, plus one linked to no tenant. A's is a PauseAI chapter. */
export const ORGANIZATIONS = {
  A: { id: fixtureId(3, 1), pauseai: true },
  B: { id: fixtureId(3, 2), pauseai: false },
  inactive: { id: fixtureId(3, 3), pauseai: false },
  unlinked: { id: fixtureId(3, 4), pauseai: false },
} as const;

/** Brand assets: a shared one every tenant may select, a restricted one granted to and selected by A, and an unused one. */
export const BRAND_ASSETS = {
  shared: { id: fixtureId(4, 1), restricted: false },
  restricted: { id: fixtureId(4, 2), restricted: true },
  unused: { id: fixtureId(4, 3), restricted: true },
} as const;

/** Fictional policy texts: a published privacy policy per tenant, plus a newer draft in A. */
export const TENANT_DOCUMENTS = {
  publishedA: { id: fixtureId(5, 1), tenant: 'A', published: true },
  draftA: { id: fixtureId(5, 2), tenant: 'A', published: false },
  publishedB: { id: fixtureId(5, 3), tenant: 'B', published: true },
  publishedInactive: { id: fixtureId(5, 4), tenant: 'inactive', published: true },
} as const satisfies Record<string, { id: string; tenant: TenantKey; published: boolean }>;

/**
 * Fictional stored files: their rows (the bytes live on the volume, under their hash, ADR-0001). The hash is of the
 * UTF-8 of `content`. The matrix covers the ones with `blob` set; the "awaiting" ones are files the fetch tests use.
 */
export const FILES = {
  sourceA: {
    id: fixtureId(6, 1),
    tenant: 'A',
    bucket: 'sources',
    type: 'application/pdf',
    content: 'pdf-a',
    blob: true,
  },
  logoA: {
    id: fixtureId(6, 2),
    tenant: 'A',
    bucket: 'public_assets',
    type: 'image/png',
    content: 'png-a',
    blob: true,
  },
  /** Uploaded brand images, each its tenant's selected logo: public for an active tenant only. */
  brandA: {
    id: fixtureId(6, 9),
    tenant: 'A',
    bucket: 'public_assets',
    type: 'image/png',
    content: 'png-logo-a',
    blob: true,
  },
  brandInactive: {
    id: fixtureId(6, 10),
    tenant: 'inactive',
    bucket: 'public_assets',
    type: 'image/png',
    content: 'png-logo-inactivo',
    blob: true,
  },
  /** An image no party or brand selection shows: it must stay private. */
  unusedImageA: {
    id: fixtureId(6, 8),
    tenant: 'A',
    bucket: 'public_assets',
    type: 'image/png',
    content: 'png-sin-uso-a',
    blob: true,
  },
  sourceB: {
    id: fixtureId(6, 3),
    tenant: 'B',
    bucket: 'sources',
    type: 'application/pdf',
    content: 'pdf-b',
    blob: true,
  },
  sourceInactive: {
    id: fixtureId(6, 4),
    tenant: 'inactive',
    bucket: 'sources',
    type: 'application/pdf',
    content: 'pdf-inactivo',
    blob: true,
  },
  awaitingA: {
    id: fixtureId(6, 5),
    tenant: 'A',
    bucket: 'sources',
    type: 'text/html',
    content: 'html-a',
    blob: false,
  },
  awaitingB: {
    id: fixtureId(6, 6),
    tenant: 'B',
    bucket: 'sources',
    type: 'text/html',
    content: 'html-b',
    blob: false,
  },
  awaitingInactive: {
    id: fixtureId(6, 7),
    tenant: 'inactive',
    bucket: 'sources',
    type: 'text/html',
    content: 'html-inactivo',
    blob: false,
  },
} as const satisfies Record<
  string,
  { id: string; tenant: TenantKey; bucket: string; type: string; content: string; blob: boolean }
>;

/** Public images: the live party's logo, and the brand image an active tenant selected. */
const PUBLIC_FILES: readonly string[] = [FILES.logoA.id, FILES.brandA.id];

export type ElectionStatus = 'draft' | 'live' | 'archived';

export interface FixtureElection {
  id: string;
  tenant: TenantKey;
  status: ElectionStatus;
  slug: string;
  type: 'general' | 'european' | 'regional' | 'municipal' | 'other';
  territory: string | null;
  /** Whether it has a methodology, an external reviewer, two parties and a criterion. */
  structure: boolean;
  /** Announced while a draft: the public sees its row, never its structure. */
  announced: boolean;
  methodology: string;
  reviewer: string;
  party: string;
  secondParty: string;
  criterion: string;
  secondCriterion: string;
}

const election = (
  n: number,
  tenant: TenantKey,
  status: ElectionStatus,
  slug: string,
  type: FixtureElection['type'],
  territory: string | null,
  structure = true,
  announced = false,
): FixtureElection => ({
  id: fixtureId(7, n),
  tenant,
  status,
  slug,
  type,
  territory,
  structure,
  announced,
  methodology: fixtureId(8, n),
  reviewer: fixtureId(9, n),
  party: fixtureId(7, 20 + n),
  secondParty: fixtureId(7, 40 + n),
  criterion: fixtureId(8, 20 + n),
  secondCriterion: fixtureId(8, 40 + n),
});

/**
 * Fictional elections (ADR-0002, fixtures): a live, a draft and an archived one in A and B, a live and a draft one in
 * the inactive tenant, and an empty draft (no structure) in each tenant, for the insert cases. The drafts with
 * structure in A and in the inactive tenant are announced; B's is not.
 */
export const ELECTIONS = {
  liveA: election(1, 'A', 'live', 'generales-de-ejemplo', 'general', null),
  draftA: election(2, 'A', 'draft', 'autonomicas-de-ejemplo', 'regional', 'XA-01', true, true),
  archivedA: election(3, 'A', 'archived', 'europeas-de-ejemplo', 'european', null),
  emptyA: election(4, 'A', 'draft', 'municipales-de-ejemplo', 'municipal', null, false),
  liveB: election(5, 'B', 'live', 'generales-de-ejemplo', 'general', null),
  draftB: election(6, 'B', 'draft', 'autonomicas-de-ejemplo', 'regional', 'XB-01'),
  archivedB: election(7, 'B', 'archived', 'europeas-de-ejemplo', 'european', null),
  emptyB: election(8, 'B', 'draft', 'municipales-de-ejemplo', 'municipal', null, false),
  liveInactive: election(9, 'inactive', 'live', 'generales-de-ejemplo', 'general', null),
  draftInactive: election(
    10,
    'inactive',
    'draft',
    'autonomicas-de-ejemplo',
    'regional',
    'XC-01',
    true,
    true,
  ),
  emptyInactive: election(
    11,
    'inactive',
    'draft',
    'municipales-de-ejemplo',
    'municipal',
    null,
    false,
  ),
} as const satisfies Record<string, FixtureElection>;

/** A global core criterion, referenced by the criterion of A's live election. */
export const CORE_CRITERION = fixtureId(9, 90);

export interface FixtureSource {
  id: string;
  election: FixtureElection;
  party: string | null;
  /** The stored copy, if any. */
  file: string | null;
  /** The extracted pages: with a copy and pages, its extraction is done; with a copy and none, it is pending. */
  pages: readonly string[];
}

/** Fictional source documents: one with a stored, extracted copy in each tenant's live election, and one without. */
export const SOURCES = {
  liveA: {
    id: fixtureId(6, 51),
    election: ELECTIONS.liveA,
    party: ELECTIONS.liveA.party,
    file: FILES.sourceA.id,
    pages: [
      'El Partido Ejemplo A propone una moratoria de ejemplo sobre los sistemas de prueba más avanzados.',
      'En la página dos, el programa de ejemplo pide una agencia de supervisión ficticia.',
    ],
  },
  draftA: { id: fixtureId(6, 52), election: ELECTIONS.draftA, party: null, file: null, pages: [] },
  /** Stored but not yet extracted: the extract job's source. */
  pendingA: {
    id: fixtureId(6, 55),
    election: ELECTIONS.draftA,
    party: null,
    file: FILES.awaitingA.id,
    pages: [],
  },
  liveB: {
    id: fixtureId(6, 53),
    election: ELECTIONS.liveB,
    party: ELECTIONS.liveB.party,
    file: FILES.sourceB.id,
    pages: ['Texto de ejemplo del programa ficticio del inquilino B.'],
  },
  liveInactive: {
    id: fixtureId(6, 54),
    election: ELECTIONS.liveInactive,
    party: ELECTIONS.liveInactive.party,
    file: FILES.sourceInactive.id,
    pages: ['Texto de ejemplo del inquilino inactivo.'],
  },
  /** Party-neutral documents, cited by the published cells: public once a public revision cites them. */
  neutralA: {
    id: fixtureId(6, 56),
    election: ELECTIONS.liveA,
    party: null,
    file: FILES.sourceA.id,
    pages: ['Documento neutral de ejemplo con una propuesta ficticia de regulación.'],
  },
  neutralB: {
    id: fixtureId(6, 57),
    election: ELECTIONS.liveB,
    party: null,
    file: FILES.sourceB.id,
    pages: ['Documento neutral de ejemplo con una propuesta ficticia de regulación.'],
  },
  neutralInactive: {
    id: fixtureId(6, 58),
    election: ELECTIONS.liveInactive,
    party: null,
    file: FILES.sourceInactive.id,
    pages: ['Documento neutral de ejemplo con una propuesta ficticia de regulación.'],
  },
} as const satisfies Record<string, FixtureSource>;

/** Fictional LLM runs, one per tenant on its live election's source, each with one open suggestion. */
export const LLM_RUNS = {
  A: {
    id: fixtureId(5, 51),
    suggestion: fixtureId(5, 61),
    source: SOURCES.liveA,
    election: ELECTIONS.liveA,
  },
  B: {
    id: fixtureId(5, 52),
    suggestion: fixtureId(5, 62),
    source: SOURCES.liveB,
    election: ELECTIONS.liveB,
  },
  inactive: {
    id: fixtureId(5, 53),
    suggestion: fixtureId(5, 63),
    source: SOURCES.liveInactive,
    election: ELECTIONS.liveInactive,
  },
} as const satisfies Record<
  TenantKey,
  { id: string; suggestion: string; source: FixtureSource; election: FixtureElection }
>;

/**
 * Fictional job requests in A, requested by the fixture platform admin: one open job of each kind the matrix exercises,
 * and a finished one, which authorizes nothing.
 */
export const JOBS = {
  fetchA: {
    id: fixtureId(5, 71),
    kind: 'fetch_source',
    source: SOURCES.draftA,
    llmRun: null,
    finished: false,
  },
  extractA: {
    id: fixtureId(5, 72),
    kind: 'extract_source',
    source: SOURCES.pendingA,
    llmRun: null,
    finished: false,
  },
  llmA: {
    id: fixtureId(5, 73),
    kind: 'llm_run',
    source: SOURCES.liveA,
    llmRun: LLM_RUNS.A.id,
    finished: false,
  },
  finishedA: {
    id: fixtureId(5, 74),
    kind: 'fetch_source',
    source: SOURCES.draftA,
    llmRun: null,
    finished: true,
  },
} as const;

/** The worker principals: the worker running each fixture job, acting for its requester. */
export const JOB_PRINCIPALS = {
  'worker: fetch job of A': { id: JOBS.fetchA.id, requester: USERS.platformAdmin },
  'worker: extract job of A': { id: JOBS.extractA.id, requester: USERS.platformAdmin },
  'worker: LLM job of A': { id: JOBS.llmA.id, requester: USERS.platformAdmin },
  'worker: finished job of A': { id: JOBS.finishedA.id, requester: USERS.platformAdmin },
} as const;

const FETCH = 'worker: fetch job of A';
const EXTRACT = 'worker: extract job of A';
const LLM = 'worker: LLM job of A';
const OPEN_JOBS = [FETCH, EXTRACT, LLM];

export interface FixtureCells {
  election: FixtureElection;
  source: FixtureSource;
  /** Writes the tenant's cells: an editor, or a country admin where the tenant has no editor principal. */
  author: string;
  /** party × criterion: a draft rated "not mentioned", backed by a checked copy of the party's programme. */
  draft: string;
  /** A quote on the draft cell, so quotes of a draft can be edited. */
  draftEvidence: string;
  /** party × second criterion: in review, rated "meets", with one quote from the programme. */
  review: string;
  evidence: string;
  quote: string;
  /** Second party × second criterion: published through the real flow, citing a party-neutral document. */
  published: string;
  neutral: FixtureSource;
  publishedQuote: string;
  /** Publishes it: a reviewer or country admin of the tenant who didn't write it (or the platform admin). */
  publisher: string;
  /** Approves the fixture's change request in its live election. */
  approver: string;
}

/** Fictional cells in each tenant's live election, on its first party. */
export const CELLS = {
  A: {
    election: ELECTIONS.liveA,
    source: SOURCES.liveA,
    author: USERS.editorA,
    draft: fixtureId(9, 51),
    draftEvidence: fixtureId(9, 60),
    review: fixtureId(9, 52),
    evidence: fixtureId(9, 53),
    quote: 'propone una moratoria de ejemplo sobre los sistemas de prueba',
    published: fixtureId(9, 63),
    neutral: SOURCES.neutralA,
    publishedQuote: 'una propuesta ficticia de regulación',
    publisher: USERS.reviewerA,
    approver: USERS.countryAdminA,
  },
  B: {
    election: ELECTIONS.liveB,
    source: SOURCES.liveB,
    author: USERS.countryAdminB,
    draft: fixtureId(9, 54),
    draftEvidence: fixtureId(9, 61),
    review: fixtureId(9, 55),
    evidence: fixtureId(9, 56),
    quote: 'Texto de ejemplo del programa ficticio',
    published: fixtureId(9, 64),
    neutral: SOURCES.neutralB,
    publishedQuote: 'una propuesta ficticia de regulación',
    publisher: USERS.editorAReviewerB,
    approver: USERS.countryAdminB,
  },
  inactive: {
    election: ELECTIONS.liveInactive,
    source: SOURCES.liveInactive,
    author: USERS.countryAdminInactive,
    draft: fixtureId(9, 57),
    draftEvidence: fixtureId(9, 62),
    review: fixtureId(9, 58),
    evidence: fixtureId(9, 59),
    quote: 'Texto de ejemplo del inquilino inactivo',
    published: fixtureId(9, 65),
    neutral: SOURCES.neutralInactive,
    publishedQuote: 'una propuesta ficticia de regulación',
    publisher: USERS.platformAdmin,
    approver: USERS.platformAdmin,
  },
} as const satisfies Record<TenantKey, FixtureCells>;

/** Memberships the fixtures create and then delete: the principal must lose access at once. */
export const REVOKED_MEMBERSHIPS: readonly { user: string; tenant: TenantKey; role: TenantRole }[] =
  [{ user: USERS.revokedA, tenant: 'A', role: 'editor' }];

export const PLATFORM_ADMINS: readonly string[] = [USERS.platformAdmin];

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
  ...Object.entries(JOB_PRINCIPALS).map(([id, job]) => ({
    id,
    role: 'aiontheballot_worker' as const,
    userId: job.requester,
    jobRequestId: job.id,
  })),
];

/** Who may perform one operation. Anyone not named is denied, including every principal at aal1. */
export interface Rule {
  /** `aiontheballot_web`, on rows marked public. Reads only: the web role never writes. */
  public?: true;
  /** Members holding one of these roles in the row's tenant, at aal2. */
  members?: readonly TenantRole[];
  /** Anyone holding any membership, at aal2: for shared platform rows offered to every tenant. */
  anyMember?: true;
  /** Platform admins at aal2, on every row. */
  platformAdmin?: true;
}

/**
 * What each worker principal may do (spec §8), by relation, then row id (or `insert <insert id>`), then operation
 * ('select', 'update', 'update:<column>', 'insert'…): the ids of the worker principals allowed. Everything else is
 * denied to the worker, which sees nothing but its one open job request and what that request names.
 */
export type WorkerAccess = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>>
>;

export interface Row {
  /** Shown in test titles. */
  id: string;
  tenant: TenantKey | null;
  /** Whether the public-visibility rule admits it. */
  public: boolean;
  /** A predicate matching exactly this fixture row. */
  where: string;
  /**
   * Rules that differ for this row's state (say, a draft row may be deleted and a published one not), by operation:
   * 'select', 'update', 'delete', or 'update:<column>' for a column update.
   */
  rules?: Readonly<Record<string, Rule>>;
  /**
   * Operations a permitted principal still can't complete, with the SQLSTATE that stops them (say, 23503 when a
   * foreign key protects a referenced row). Denied principals must still be stopped by the security layers.
   */
  blocked?: Readonly<Record<string, string>>;
}

export interface Insert {
  id: string;
  tenant: TenantKey | null;
  sql: string;
  /** Who may perform this insert, when it differs from the relation's insert rule. */
  rule?: Rule;
  /** The SQLSTATE that stops a permitted principal (an integrity rule), as for Row.blocked. */
  blocked?: string;
}

export interface Relation {
  /** A view: read only, so it gets no update or delete cases (Postgres refuses those before checking grants). */
  view?: true;
  rows: readonly Row[];
  inserts: readonly Insert[];
  /** The SET clause of the plain update case: a change any permitted writer may make. */
  set: string;
  select: Rule;
  insert: Rule;
  update: Rule;
  delete: Rule;
  /** Columns read one by one, for those hidden from the public by column grants. */
  columnReads?: Readonly<Record<string, Rule>>;
  /** Sensitive columns updated one by one (ADR-0002, dimensions): the SET clause and who may apply it. */
  columnUpdates?: Readonly<Record<string, { set: string; rule: Rule }>>;
}

const NOBODY: Rule = {};
const MEMBERS: Rule = { members: ALL_ROLES, platformAdmin: true };
const COUNTRY_ADMINS: Rule = { members: ['country_admin'], platformAdmin: true };
const PLATFORM_ADMIN: Rule = { platformAdmin: true };
/** Who reviews: publishes cells and decides change requests (ADR-0002, capabilities by role). */
const REVIEWERS: Rule = { members: ['reviewer', 'country_admin'], platformAdmin: true };
/** Who approves a change request: an approver applies it with their own rights, which reviewers lack. */
const APPROVERS: Rule = COUNTRY_ADMINS;
/** Who triages right-of-reply reports: every member, never a platform admin (ADR-0002, capabilities by role). */
const TRIAGERS: Rule = { members: ALL_ROLES };
/** Who writes drafts, evidence and sources (ADR-0002, capabilities by role). */
const EDITORS: Rule = { members: ['editor', 'country_admin'], platformAdmin: true };

/** Whether an election's structure and content are public: only once it is live (or archived). */
const isPublic = (e: FixtureElection): boolean => e.status !== 'draft' && TENANTS[e.tenant].active;
/** Whether an election's own row is public: also while it is an announced draft. */
const isListed = (e: FixtureElection): boolean =>
  isPublic(e) || (e.status === 'draft' && e.announced && TENANTS[e.tenant].active);
const structured: readonly FixtureElection[] = Object.values(ELECTIONS).filter((e) => e.structure);
/** The draft election with structure of a tenant, where insert cases add rows. */
const draftOf = (key: TenantKey): FixtureElection => {
  const e = structured.find(
    (candidate) => candidate.tenant === key && candidate.status === 'draft',
  );
  if (!e) {
    throw new Error(`No structured draft election in tenant ${key}`);
  }
  return e;
};
/** The empty draft election of a tenant (no methodology yet). */
const emptyOf = (key: TenantKey): FixtureElection => {
  const e = Object.values(ELECTIONS).find(
    (candidate) => candidate.tenant === key && !candidate.structure,
  );
  if (!e) {
    throw new Error(`No empty election in tenant ${key}`);
  }
  return e;
};
/** A row of an election's structure: only a draft election's may be deleted. */
const structureRow = (e: FixtureElection, label: string, where: string, deletable: Rule): Row => ({
  id: `${label} of ${e.tenant} ${e.status}`,
  tenant: e.tenant,
  public: isPublic(e),
  where,
  rules: { delete: e.status === 'draft' ? deletable : NOBODY },
  // An archived election is read-only; a live one changes only through approved change requests.
  ...(e.status !== 'draft' ? { blocked: { update: '23001' } } : {}),
});

const tenantRow = (key: TenantKey): Row => ({
  id: `tenant ${key}`,
  tenant: key,
  public: TENANTS[key].active,
  where: `id = '${TENANTS[key].id}'`,
  // Every fixture tenant has methodologies (the kind is fixed) and a regional election using its country code.
  blocked: { 'update:methodology_kind': '23001', 'update:country_code': '23514' },
});

const membershipRow = (key: TenantKey): Row => {
  const m = MEMBERSHIPS.find((candidate) => candidate.tenant === key);
  if (!m) {
    throw new Error(`No fixture membership in tenant ${key}`);
  }
  return {
    id: `${m.role} of ${key}`,
    tenant: key,
    public: false,
    where: `user_id = '${m.user}' AND tenant_id = '${TENANTS[key].id}' AND role = '${m.role}'`,
  };
};

const TENANT_KEYS: readonly TenantKey[] = ['A', 'B', 'inactive'];

/** Relation name (`schema.name`) → its expectations. */
export const RELATIONS: Readonly<Record<string, Relation>> = {
  'app.platform_admins': {
    rows: [
      {
        id: 'platform admin',
        tenant: null,
        public: false,
        where: `user_id = '${USERS.platformAdmin}'`,
      },
    ],
    inserts: [
      {
        id: 'new platform admin',
        tenant: null,
        sql: `INSERT INTO app.platform_admins (user_id) VALUES ('${USERS.newcomer}')`,
      },
    ],
    set: 'user_id = user_id',
    select: PLATFORM_ADMIN,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.tenants': {
    rows: TENANT_KEYS.map(tenantRow),
    inserts: [
      {
        id: 'new tenant',
        tenant: null,
        sql: `INSERT INTO app.tenants (slug, country_code, default_locale, enabled_locales, display_name,
                methodology_kind, report_retention_days)
              VALUES ('test-new', 'XN', 'es', '{es}', '{"es": "Inquilino de prueba nuevo"}', 'demands', 365)`,
      },
    ],
    set: `theme = '{"primary": "#123456"}'`,
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: COUNTRY_ADMINS,
    delete: NOBODY,
    columnReads: {
      live_edits_need_second_approver: MEMBERS,
      report_retention_days: MEMBERS,
      llm_monthly_cap_usd: MEMBERS,
    },
    columnUpdates: {
      report_retention_days: {
        set: 'report_retention_days = report_retention_days + 1',
        rule: COUNTRY_ADMINS,
      },
      llm_monthly_cap_usd: {
        set: 'llm_monthly_cap_usd = llm_monthly_cap_usd + 1',
        rule: COUNTRY_ADMINS,
      },
      active: { set: 'active = NOT active', rule: PLATFORM_ADMIN },
      methodology_kind: {
        set: `methodology_kind = CASE methodology_kind WHEN 'demands' THEN 'descriptive'::app.methodology_kind
                                                        ELSE 'demands' END`,
        rule: PLATFORM_ADMIN,
      },
      live_edits_need_second_approver: {
        set: 'live_edits_need_second_approver = NOT live_edits_need_second_approver',
        rule: PLATFORM_ADMIN,
      },
      slug: { set: `slug = slug || '-renamed'`, rule: PLATFORM_ADMIN },
      country_code: { set: `country_code = 'XZ'`, rule: PLATFORM_ADMIN },
      enabled_locales: {
        set: `enabled_locales = enabled_locales || '{ca}'::app.locale[]`,
        rule: PLATFORM_ADMIN,
      },
      display_name: {
        set: `display_name = '{"es": "Inquilino de prueba renombrado"}'`,
        rule: PLATFORM_ADMIN,
      },
      id: { set: 'id = uuidv7()', rule: NOBODY },
      created_at: { set: 'created_at = now()', rule: NOBODY },
    },
  },

  'app.audit_log': {
    rows: [
      {
        id: 'platform-level entry',
        tenant: null,
        public: false,
        where: `table_name = 'platform_admins' AND row_id = '${USERS.platformAdmin}'`,
      },
      ...TENANT_KEYS.map((key) => ({
        id: `entry of ${key}`,
        tenant: key,
        public: false,
        where: `table_name = 'tenants' AND action = 'insert' AND row_id = '${TENANTS[key].id}'`,
      })),
    ],
    inserts: TENANT_KEYS.map((key) => ({
      id: `forged entry in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.audit_log (tenant_id, action, table_name, row_id)
            VALUES ('${TENANTS[key].id}', 'update', 'tenants', '${TENANTS[key].id}')`,
    })),
    set: 'action = action',
    select: COUNTRY_ADMINS,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
    columnUpdates: {
      actor_id: { set: `actor_id = '${USERS.newcomer}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.public_versions': {
    rows: TENANT_KEYS.map((key) => ({
      id: `version of ${key}`,
      tenant: key,
      public: TENANTS[key].active,
      where: `tenant_id = '${TENANTS[key].id}'`,
    })),
    inserts: [
      {
        id: 'version for a new tenant',
        tenant: null,
        sql: `INSERT INTO app.public_versions (tenant_id, version) VALUES ('${TENANT_A}', 0)`,
      },
    ],
    set: 'version = 0',
    select: { public: true },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.invitations': {
    rows: [
      ...TENANT_KEYS.map((key) => ({
        id: `pending invitation of ${key}`,
        tenant: key,
        public: false,
        where: `token_hash = encode(sha256('${INVITATION_TOKENS[key]}'), 'hex')`,
        rules: { delete: NOBODY },
      })),
      {
        id: 'revoked invitation of A',
        tenant: 'A',
        public: false,
        where: `token_hash = encode(sha256('${REVOKED_INVITATION_TOKEN}'), 'hex')`,
        rules: { update: NOBODY },
      },
    ],
    inserts: TENANT_KEYS.map((key) => ({
      id: `invitation into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.invitations (tenant_id, email, role, token_hash, expires_at)
            VALUES ('${TENANTS[key].id}', 'persona-nueva@example.org', 'editor',
                    encode(sha256('token-nuevo-${key}'), 'hex'), now() + interval '7 days')`,
    })),
    set: 'revoked_at = now()',
    select: COUNTRY_ADMINS,
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      email: { set: `email = 'otra-persona@example.org'`, rule: NOBODY },
      role: { set: `role = 'country_admin'`, rule: NOBODY },
      token_hash: { set: `token_hash = encode(sha256('token-cambiado'), 'hex')`, rule: NOBODY },
      expires_at: { set: `expires_at = now() + interval '20 days'`, rule: NOBODY },
      accepted_at: { set: 'accepted_at = now()', rule: NOBODY },
      accepted_by: { set: `accepted_by = '${USERS.newcomer}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      created_by: { set: `created_by = '${USERS.newcomer}'`, rule: NOBODY },
    },
  },

  'app.platform_hostnames': {
    rows: [
      {
        id: 'reserved host',
        tenant: null,
        public: false,
        where: `hostname = '${PLATFORM_HOSTNAME}'`,
      },
    ],
    inserts: [
      {
        id: 'new reserved host',
        tenant: null,
        sql: `INSERT INTO app.platform_hostnames (hostname) VALUES ('plataforma.test')`,
      },
    ],
    set: 'hostname = hostname',
    select: PLATFORM_ADMIN,
    insert: PLATFORM_ADMIN,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.tenant_hostnames': {
    rows: HOSTNAMES.map((h) => ({
      id: `${h.verified ? '' : 'unverified '}${h.retired ? 'retired ' : ''}${h.canonical ? 'canonical ' : ''}host of ${h.tenant}`,
      tenant: h.tenant,
      public: h.verified && TENANTS[h.tenant].active,
      where: `hostname = '${h.hostname}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `host for ${key}`,
      tenant: key,
      sql: `INSERT INTO app.tenant_hostnames (hostname, tenant_id)
            VALUES ('nuevo-${key.toLowerCase()}.example.test', '${TENANTS[key].id}')`,
    })),
    set: 'is_canonical = is_canonical',
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: NOBODY,
    columnUpdates: {
      hostname: { set: `hostname = 'robado.example.test'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      created_at: { set: 'created_at = now()', rule: NOBODY },
    },
  },

  'app.hostname_tombstones': {
    rows: [
      { id: 'tombstone', tenant: null, public: true, where: `hostname = '${TOMBSTONE_HOSTNAME}'` },
    ],
    inserts: [
      {
        id: 'new tombstone',
        tenant: null,
        sql: `INSERT INTO app.hostname_tombstones (hostname) VALUES ('otro-purgado.example.test')`,
      },
    ],
    set: 'purged_at = purged_at',
    select: { public: true, platformAdmin: true },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.hostname_verifications': {
    rows: [
      {
        id: 'verification of an A host',
        tenant: null,
        public: false,
        where: `hostname = '${VERIFYING_HOSTNAME}'`,
      },
    ],
    inserts: [
      {
        id: 'verification of a B host',
        tenant: null,
        sql: `INSERT INTO app.hostname_verifications (hostname, token_hash)
              VALUES ('test-b.example.test', encode(sha256('txt-b'), 'hex'))`,
      },
    ],
    set: `last_result = 'not found'`,
    select: PLATFORM_ADMIN,
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: NOBODY,
    columnUpdates: {
      hostname: { set: `hostname = 'test-b.example.test'`, rule: NOBODY },
    },
  },

  'app.organizations': {
    rows: [
      ...TENANT_KEYS.map((key) => ({
        id: `operator of ${key}`,
        tenant: key,
        public: TENANTS[key].active,
        where: `id = '${ORGANIZATIONS[key].id}'`,
        blocked: { delete: '23503' },
      })),
      {
        id: 'unlinked organization',
        tenant: null,
        public: false,
        where: `id = '${ORGANIZATIONS.unlinked.id}'`,
      },
    ],
    inserts: [
      {
        id: 'new organization',
        tenant: null,
        sql: `INSERT INTO app.organizations (display_name, legal_name)
              VALUES ('{"es": "Organización nueva"}', 'Organización Nueva de Ejemplo')`,
      },
    ],
    set: `legal_name = legal_name || ' (renombrada)'`,
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: PLATFORM_ADMIN,
    columnUpdates: {
      id: { set: 'id = uuidv7()', rule: NOBODY },
      created_at: { set: 'created_at = now()', rule: NOBODY },
    },
  },

  'app.tenant_organizations': {
    rows: TENANT_KEYS.map((key) => ({
      id: `operator link of ${key}`,
      tenant: key,
      public: TENANTS[key].active,
      where: `tenant_id = '${TENANTS[key].id}' AND organization_id = '${ORGANIZATIONS[key].id}'`,
      // An active tenant always has its operator.
      ...(TENANTS[key].active ? { blocked: { delete: '23514' } } : {}),
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `endorser of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.tenant_organizations (tenant_id, organization_id, role)
            VALUES ('${TENANTS[key].id}', '${ORGANIZATIONS.unlinked.id}', 'endorser')`,
    })),
    set: 'display_order = display_order + 1',
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: PLATFORM_ADMIN,
    columnUpdates: {
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.brand_assets': {
    rows: [
      {
        id: 'shared asset',
        tenant: null,
        public: true,
        where: `id = '${BRAND_ASSETS.shared.id}'`,
        rules: { select: { public: true, anyMember: true, platformAdmin: true } },
        blocked: { delete: '23503' },
      },
      {
        id: 'restricted asset granted to A',
        tenant: 'A',
        public: true,
        where: `id = '${BRAND_ASSETS.restricted.id}'`,
        blocked: { delete: '23503' },
      },
      {
        id: 'unused restricted asset',
        tenant: null,
        public: false,
        where: `id = '${BRAND_ASSETS.unused.id}'`,
      },
    ],
    inserts: [
      {
        id: 'new asset',
        tenant: null,
        sql: `INSERT INTO app.brand_assets (name, content_type, sha256, byte_size)
              VALUES ('Logo nuevo de ejemplo', 'image/png', encode(sha256('\\x89504e47'::bytea), 'hex'), 4)`,
      },
    ],
    set: `name = name || ' v2'`,
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: PLATFORM_ADMIN,
    columnUpdates: {
      // An asset's bytes never change: its hash and size are fixed (the bytes are on the volume, under the hash).
      sha256: { set: `sha256 = encode(sha256('\\x00'::bytea), 'hex')`, rule: NOBODY },
      byte_size: { set: 'byte_size = byte_size + 1', rule: NOBODY },
    },
  },

  'app.brand_asset_grants': {
    rows: [
      {
        id: 'grant to A',
        tenant: 'A',
        public: false,
        where: `brand_asset_id = '${BRAND_ASSETS.restricted.id}' AND tenant_id = '${TENANT_A}'`,
        // A selects the asset, so the grant can't go while the selection stays.
        blocked: { delete: '23514' },
      },
    ],
    inserts: TENANT_KEYS.map((key) => ({
      id: `grant to ${key}`,
      tenant: key,
      sql: `INSERT INTO app.brand_asset_grants (brand_asset_id, tenant_id)
            VALUES ('${BRAND_ASSETS.unused.id}', '${TENANTS[key].id}')`,
    })),
    set: 'granted_at = granted_at',
    select: MEMBERS,
    insert: PLATFORM_ADMIN,
    update: NOBODY,
    delete: PLATFORM_ADMIN,
  },

  'app.tenant_brand_selections': {
    rows: [
      {
        id: 'restricted mark of A',
        tenant: 'A',
        public: true,
        where: `tenant_id = '${TENANT_A}' AND slot = 'header_mark'`,
      },
      ...TENANT_KEYS.map((key) => ({
        id: `product logo of ${key}`,
        tenant: key,
        public: TENANTS[key].active,
        where: `tenant_id = '${TENANTS[key].id}' AND slot = 'product_logo'`,
      })),
      ...(['A', 'inactive'] as const).map((key) => ({
        id: `uploaded logo of ${key}`,
        tenant: key,
        public: TENANTS[key].active,
        where: `tenant_id = '${TENANTS[key].id}' AND slot = 'operator_logo_on_canvas'`,
      })),
    ],
    inserts: [
      ...TENANT_KEYS.map((key) => ({
        id: `footer mark of ${key}`,
        tenant: key,
        sql: `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id)
              VALUES ('${TENANTS[key].id}', 'footer_mark', '${BRAND_ASSETS.shared.id}')`,
      })),
      {
        id: 'uploaded image as a logo of A',
        tenant: 'A' as const,
        sql: `INSERT INTO app.tenant_brand_selections (tenant_id, slot, file_id)
              VALUES ('${TENANT_A}', 'operator_logo_on_accent', '${FILES.unusedImageA.id}')`,
      },
    ],
    set: 'brand_asset_id = brand_asset_id',
    select: { public: true, ...MEMBERS },
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      file_id: { set: 'file_id = file_id', rule: COUNTRY_ADMINS },
    },
  },

  'app.tenant_documents': {
    rows: Object.entries(TENANT_DOCUMENTS).map(([name, doc]) => ({
      id: `${doc.published ? 'published' : 'draft'} document of ${doc.tenant}${name === 'draftA' ? ' (draft)' : ''}`,
      tenant: doc.tenant,
      public: doc.published && TENANTS[doc.tenant].active,
      where: `id = '${doc.id}'`,
      ...(doc.published
        ? { rules: { update: NOBODY, delete: NOBODY, 'update:published_at': NOBODY } }
        : {}),
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `draft for ${key}`,
      tenant: key,
      sql: `INSERT INTO app.tenant_documents (tenant_id, kind, body)
            VALUES ('${TENANTS[key].id}', 'right_of_reply_policy', '{"es": "Política de réplica de ejemplo"}')`,
    })),
    set: `body = '{"es": "Texto revisado de ejemplo"}'`,
    select: { public: true, ...MEMBERS },
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      published_at: { set: 'published_at = now()', rule: COUNTRY_ADMINS },
      kind: { set: `kind = 'about_operator'`, rule: NOBODY },
      version: { set: 'version = version + 10', rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      created_by: { set: `created_by = '${USERS.newcomer}'`, rule: NOBODY },
    },
  },

  'app.files': {
    rows: Object.entries(FILES)
      .filter(([, f]) => f.blob)
      .map(([name, f]) => ({
        id: `${name} file`,
        tenant: f.tenant,
        public: PUBLIC_FILES.includes(f.id),
        where: `id = '${f.id}'`,
        // A party or a brand selection shows it, or a source keeps it as its stored copy, so it can't be deleted.
        ...([
          FILES.logoA.id,
          FILES.brandA.id,
          FILES.brandInactive.id,
          FILES.sourceA.id,
          FILES.sourceB.id,
          FILES.sourceInactive.id,
        ].includes(f.id)
          ? { blocked: { delete: '23503' } }
          : {}),
      })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `upload into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256, original_filename)
            VALUES ('${TENANTS[key].id}', 'sources', 'application/pdf', 5, encode(sha256('nuevo'), 'hex'),
                    'programa.pdf')`,
    })),
    set: 'content_type = content_type',
    select: { public: true, ...MEMBERS },
    insert: EDITORS,
    update: NOBODY,
    delete: EDITORS,
    columnReads: { original_filename: MEMBERS, created_by: MEMBERS },
  },

  'app.core_criteria': {
    rows: [
      {
        id: 'core criterion',
        tenant: null,
        public: true,
        where: `id = '${CORE_CRITERION}'`,
        // A criterion references it.
        blocked: { delete: '23503' },
      },
    ],
    inserts: [
      {
        id: 'new core criterion',
        tenant: null,
        sql: `INSERT INTO app.core_criteria (key, title, description)
              VALUES ('criterio-comun-nuevo', '{"es": "Criterio común nuevo"}', '{"es": "Descripción de ejemplo"}')`,
      },
    ],
    set: `title = '{"es": "Criterio común revisado"}'`,
    select: { public: true, anyMember: true, platformAdmin: true },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: PLATFORM_ADMIN,
  },

  'app.elections': {
    rows: Object.entries(ELECTIONS).map(([name, e]): Row => ({
      id: `${name} election`,
      tenant: e.tenant,
      public: isListed(e),
      where: `id = '${e.id}'`,
      // Only a draft is deleted, and only once its structure is gone; an archived election is read-only.
      ...(e.status !== 'draft'
        ? { rules: { delete: NOBODY } }
        : e.structure
          ? { blocked: { delete: '23503' } }
          : {}),
      ...(e.status === 'archived'
        ? {
            blocked: {
              update: '23001',
              'update:frozen_from': '23001',
              'update:require_second_reviewer': '23001',
              'update:announced': '23001',
            },
          }
        : // Renaming a live election needs an approved change request; the announcement is fixed once live.
          e.status === 'live'
          ? { blocked: { update: '23001', 'update:announced': '23001' } }
          : {}),
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `election in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.elections (tenant_id, slug, type, name)
            VALUES ('${TENANTS[key].id}', 'elecciones-nuevas', 'other', '{"es": "Elecciones nuevas de ejemplo"}')`,
    })),
    set: `name = '{"es": "Elecciones de ejemplo (renombradas)"}'`,
    select: { public: true, ...MEMBERS },
    insert: EDITORS,
    update: EDITORS,
    delete: COUNTRY_ADMINS,
    columnReads: {
      require_second_reviewer: MEMBERS,
      frozen_from: MEMBERS,
      frozen_until: MEMBERS,
    },
    columnUpdates: {
      frozen_from: { set: 'frozen_from = now()', rule: COUNTRY_ADMINS },
      announced: { set: 'announced = NOT announced', rule: COUNTRY_ADMINS },
      require_second_reviewer: {
        set: 'require_second_reviewer = NOT require_second_reviewer',
        rule: PLATFORM_ADMIN,
      },
      went_live_at: { set: 'went_live_at = now()', rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      created_at: { set: 'created_at = now()', rule: NOBODY },
    },
  },

  'app.methodologies': {
    rows: structured.map((e) => ({
      ...structureRow(e, 'methodology', `id = '${e.methodology}'`, COUNTRY_ADMINS),
      // Its external reviewer references it.
      ...(e.status === 'draft' ? { blocked: { delete: '23503' } } : {}),
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `methodology of the empty election of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.methodologies (tenant_id, election_id, kind, demands_owner_id, body)
            VALUES ('${TENANTS[key].id}', '${emptyOf(key).id}', 'demands', '${ORGANIZATIONS[key].id}',
                    '{"es": "Metodología de ejemplo"}')`,
    })),
    set: `body = '{"es": "Metodología de ejemplo revisada"}'`,
    select: { public: true, ...MEMBERS },
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      election_id: { set: `election_id = '${ELECTIONS.emptyA.id}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.methodology_reviewers': {
    rows: structured.map((e) =>
      structureRow(e, 'external reviewer', `id = '${e.reviewer}'`, COUNTRY_ADMINS),
    ),
    inserts: TENANT_KEYS.map((key) => ({
      id: `external reviewer in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
            VALUES ('${TENANTS[key].id}', '${draftOf(key).methodology}', 'Persona Revisora de Ejemplo',
                    'Universidad de Ejemplo')`,
    })),
    set: `affiliation = 'Instituto de Ejemplo'`,
    select: { public: true, ...MEMBERS },
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      methodology_id: { set: `methodology_id = '${ELECTIONS.liveA.methodology}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.parties': {
    rows: structured.map((e): Row => {
      const row = structureRow(e, 'party', `id = '${e.party}'`, EDITORS);
      // The programme status needs no change request once live, but a source marked as the party's programme (only
      // live elections' first parties have one); an archived election is read-only.
      const programme: Record<string, string> =
        e.status === 'live'
          ? {}
          : { 'update:programme_status': e.status === 'draft' ? '23514' : '23001' };
      return { ...row, blocked: { ...row.blocked, ...programme } };
    }),
    inserts: TENANT_KEYS.map((key) => ({
      id: `party in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
            VALUES ('${TENANTS[key].id}', '${draftOf(key).id}', 'partido-ejemplo-nuevo',
                    '{"es": "Partido Ejemplo Nuevo"}', '{"es": "PEN"}', 9)`,
    })),
    set: `colour = '#123456'`,
    select: { public: true, ...MEMBERS },
    insert: EDITORS,
    update: EDITORS,
    delete: EDITORS,
    columnUpdates: {
      programme_status: { set: `programme_status = 'published'`, rule: EDITORS },
      election_id: { set: `election_id = '${ELECTIONS.emptyA.id}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.criteria': {
    rows: structured.map((e) => {
      const row = structureRow(e, 'criterion', `id = '${e.criterion}'`, EDITORS);
      // Once live, the short title is change-controlled like the rest; archived, read-only.
      return e.status === 'draft'
        ? row
        : { ...row, blocked: { ...row.blocked, 'update:short_title': '23001' } };
    }),
    inserts: TENANT_KEYS.map((key) => ({
      id: `criterion in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.criteria (tenant_id, election_id, slug, title, description, display_order)
            VALUES ('${TENANTS[key].id}', '${draftOf(key).id}', 'criterio-de-ejemplo-nuevo',
                    '{"es": "Criterio de ejemplo nuevo"}', '{"es": "Descripción de ejemplo"}', 9)`,
    })),
    set: 'display_order = display_order + 1',
    select: { public: true, ...MEMBERS },
    insert: EDITORS,
    update: EDITORS,
    delete: EDITORS,
    columnUpdates: {
      short_title: { set: `short_title = '{"es": "Ejemplo revisado"}'`, rule: EDITORS },
      election_id: { set: `election_id = '${ELECTIONS.emptyA.id}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.source_documents': {
    rows: Object.entries(SOURCES).map(([name, src]): Row => ({
      id: `${name} source`,
      tenant: src.election.tenant,
      // Public once a public revision cites it: the party-neutral documents the published cells quote.
      public: Object.values(CELLS).some((c) => c.neutral.id === src.id) && isPublic(src.election),
      where: `id = '${src.id}'`,
      // Once its copy is stored, a source never changes (only its extraction status and archive, by the worker); its
      // text, LLM runs or job requests keep it from being deleted.
      blocked: src.file ? { update: '23001', delete: '23503' } : { delete: '23503' },
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `source in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.source_documents (tenant_id, election_id, kind, title, url)
            VALUES ('${TENANTS[key].id}', '${draftOf(key).id}', 'web_page', 'Página de ejemplo',
                    'https://example.org/programa')`,
    })),
    set: `title = 'Título revisado de ejemplo'`,
    select: { public: true, ...MEMBERS },
    insert: EDITORS,
    update: EDITORS,
    delete: EDITORS,
    // Never shown to the public, even for a cited source (spec §5).
    columnReads: {
      tenant_id: MEMBERS,
      file_id: MEMBERS,
      file_origin: MEMBERS,
      extraction_status: MEMBERS,
      created_by: MEMBERS,
      created_at: MEMBERS,
    },
    columnUpdates: {
      extraction_status: { set: `extraction_status = 'not_applicable'`, rule: NOBODY },
      archive_url: { set: `archive_url = 'https://archive.example.org/x'`, rule: NOBODY },
      sha256: { set: `sha256 = encode(sha256('x'), 'hex')`, rule: NOBODY },
      retrieved_at: { set: 'retrieved_at = now()', rule: NOBODY },
      election_id: { set: `election_id = '${ELECTIONS.emptyA.id}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      created_by: { set: `created_by = '${USERS.newcomer}'`, rule: NOBODY },
    },
  },

  'app.source_texts': {
    rows: Object.entries(SOURCES)
      .filter(([, src]) => src.pages.length > 0)
      .map(([name, src]) => ({
        id: `first page of ${name}`,
        tenant: src.election.tenant,
        public: false,
        where: `source_document_id = '${src.id}' AND unit_index = 1`,
      })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `page of the draft source of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
            VALUES ('${SOURCES.draftA.id}', '${TENANTS[key].id}', 1, 'p. 1', 'Texto añadido a mano')`,
    })),
    set: `body = 'Texto cambiado'`,
    select: MEMBERS,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.llm_runs': {
    rows: TENANT_KEYS.map((key) => ({
      id: `run of ${key}`,
      tenant: key,
      public: false,
      where: `id = '${LLM_RUNS[key].id}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `run in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.llm_runs (tenant_id, election_id, source_document_id, model, prompt_version)
            VALUES ('${TENANTS[key].id}', '${LLM_RUNS[key].election.id}', '${LLM_RUNS[key].source.id}',
                    'modelo-de-ejemplo', 'v1')`,
    })),
    set: `status = 'running'`,
    select: MEMBERS,
    insert: EDITORS,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.llm_suggestions': {
    rows: TENANT_KEYS.map((key) => ({
      id: `suggestion of ${key}`,
      tenant: key,
      public: false,
      where: `id = '${LLM_RUNS[key].suggestion}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `suggestion in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.llm_suggestions (tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating,
                                             rationale, passages)
            VALUES ('${TENANTS[key].id}', '${LLM_RUNS[key].election.id}', '${LLM_RUNS[key].id}',
                    '${LLM_RUNS[key].election.party}', '${LLM_RUNS[key].election.criterion}', 'meets',
                    'Razonamiento de ejemplo', '[]')`,
    })),
    set: `state = 'rejected'`,
    select: MEMBERS,
    insert: NOBODY,
    update: EDITORS,
    delete: NOBODY,
    columnUpdates: {
      suggested_rating: { set: `suggested_rating = 'does_not_meet'`, rule: NOBODY },
      passages: { set: `passages = '[]'`, rule: NOBODY },
      decided_by: { set: `decided_by = '${USERS.newcomer}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.job_requests': {
    rows: Object.entries(JOBS).map(([name, job]) => ({
      id: `${name} job`,
      tenant: 'A' as const,
      public: false,
      where: `id = '${job.id}'`,
    })),
    inserts: TENANT_KEYS.map((key) => {
      const live = Object.values(SOURCES).find(
        (src) => src.election.tenant === key && src.pages.length > 0,
      );
      return {
        id: `archive job in ${key}`,
        tenant: key,
        sql: `INSERT INTO app.job_requests (tenant_id, kind, source_document_id)
              VALUES ('${TENANTS[key].id}', 'archive_source', '${live?.id ?? ''}')`,
      };
    }),
    set: 'finished_at = now()',
    select: MEMBERS,
    insert: EDITORS,
    update: NOBODY,
    delete: NOBODY,
    columnUpdates: {
      kind: { set: `kind = 'archive_source'`, rule: NOBODY },
      source_document_id: { set: `source_document_id = '${SOURCES.liveA.id}'`, rule: NOBODY },
      requested_by: { set: `requested_by = '${USERS.newcomer}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.assessments': {
    rows: TENANT_KEYS.flatMap((key): Row[] => [
      {
        id: `draft cell of ${key}`,
        tenant: key,
        public: false,
        where: `id = '${CELLS[key].draft}'`,
        blocked: { 'update:state (publish)': '23001' },
      },
      {
        id: `cell in review of ${key}`,
        tenant: key,
        public: false,
        where: `id = '${CELLS[key].review}'`,
        // Leaving it at in_review changes nothing; its content is locked; its review trail keeps it.
        rules: { 'update:state (submit)': MEMBERS },
        blocked: { update: '23001', delete: '23503', 'update:state (publish)': '23001' },
      },
      {
        id: `published cell of ${key}`,
        tenant: key,
        public: false,
        where: `id = '${CELLS[key].published}'`,
        // An edit returns it to draft; it is never deleted; it is submitted only after an edit; it stays published.
        rules: {
          delete: NOBODY,
          'update:state (submit)': MEMBERS,
          'update:state (publish)': MEMBERS,
        },
        blocked: { 'update:state (submit)': '23001' },
      },
    ]),
    inserts: TENANT_KEYS.map((key) => ({
      id: `cell in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
            VALUES ('${TENANTS[key].id}', '${CELLS[key].election.id}', '${CELLS[key].election.secondParty}',
                    '${CELLS[key].election.criterion}', 'meets', '{"es": "Resumen de ejemplo"}')`,
    })),
    set: `draft_summary = '{"es": "Resumen revisado de ejemplo"}'`,
    select: MEMBERS,
    insert: EDITORS,
    update: EDITORS,
    delete: EDITORS,
    columnUpdates: {
      // Submitting: the draft cells meet every precondition. Recalling and rejecting depend on who contributed, so
      // they are data-rule tests (workflow.spec.ts).
      'state (submit)': { set: `state = 'in_review'`, rule: EDITORS },
      // Only the publish trigger, as the table owner, sets a cell published (blocked on every row).
      'state (publish)': { set: `state = 'published'`, rule: MEMBERS },
      // Not content: allowed in review too.
      recheck_reason: { set: `recheck_reason = 'Motivo de ejemplo'`, rule: EDITORS },
      generation: { set: 'generation = generation + 1', rule: NOBODY },
      content_version: { set: 'content_version = content_version + 1', rule: NOBODY },
      updated_by: { set: `updated_by = '${USERS.newcomer}'`, rule: NOBODY },
      party_id: { set: `party_id = '${ELECTIONS.liveA.secondParty}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.assessment_contributors': {
    rows: TENANT_KEYS.map((key) => ({
      id: `author of the draft cell of ${key}`,
      tenant: key,
      public: false,
      where: `assessment_id = '${CELLS[key].draft}' AND generation = 0 AND user_id = '${CELLS[key].author}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `someone else into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
            VALUES ('${CELLS[key].review}', '${TENANTS[key].id}', 0, '${USERS.newcomer}')`,
    })),
    set: 'generation = generation',
    select: MEMBERS,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.draft_evidence': {
    rows: TENANT_KEYS.flatMap((key): Row[] => [
      {
        id: `quote of the draft cell of ${key}`,
        tenant: key,
        public: false,
        where: `id = '${CELLS[key].draftEvidence}'`,
        // Quotes from a source with text are matched, never attested.
        blocked: { 'update:attested_by': '23514' },
      },
      {
        id: `quote in review of ${key}`,
        tenant: key,
        public: false,
        where: `id = '${CELLS[key].evidence}'`,
        // Locked while its cell is in review.
        blocked: {
          update: '23001',
          'update:quote': '23001',
          delete: '23001',
          'update:attested_by': '23514',
        },
      },
    ]),
    inserts: TENANT_KEYS.flatMap((key) => [
      {
        id: `quote for the draft cell of ${key}`,
        tenant: key,
        sql: `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
              VALUES ('${TENANTS[key].id}', '${CELLS[key].election.id}', '${CELLS[key].draft}',
                      '${CELLS[key].source.id}', 2, '${CELLS[key].quote}')`,
      },
      {
        id: `quote for the cell in review of ${key}`,
        tenant: key,
        sql: `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
              VALUES ('${TENANTS[key].id}', '${CELLS[key].election.id}', '${CELLS[key].review}',
                      '${CELLS[key].source.id}', 2, '${CELLS[key].quote}')`,
        blocked: '23001',
      },
    ]),
    set: `section_label = 'Sección de ejemplo'`,
    select: MEMBERS,
    insert: EDITORS,
    update: EDITORS,
    delete: EDITORS,
    columnUpdates: {
      quote: { set: `quote = quote || ' (revisada)'`, rule: EDITORS },
      // Any member may attest (blocked here: these quotes are matched instead).
      attested_by: { set: `attested_by = '${USERS.reviewerA}'`, rule: MEMBERS },
      match_status: { set: `match_status = 'matched'`, rule: NOBODY },
      created_by: { set: `created_by = '${USERS.newcomer}'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.draft_checked_documents': {
    rows: TENANT_KEYS.map((key) => ({
      id: `checked programme of ${key}`,
      tenant: key,
      public: false,
      where: `assessment_id = '${CELLS[key].draft}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `checked programme for the cell in review of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
            VALUES ('${CELLS[key].review}', '${TENANTS[key].id}', '${CELLS[key].election.id}', '${CELLS[key].source.id}')`,
      // Locked while its cell is in review.
      blocked: '23001',
    })),
    set: 'checked_at = checked_at',
    select: MEMBERS,
    insert: EDITORS,
    update: NOBODY,
    delete: EDITORS,
  },

  'app.review_events': {
    rows: TENANT_KEYS.map((key) => ({
      id: `submission of the cell in review of ${key}`,
      tenant: key,
      public: false,
      where: `assessment_id = '${CELLS[key].review}' AND kind = 'submitted'`,
    })),
    inserts: TENANT_KEYS.flatMap((key) => [
      {
        id: `comment in ${key}`,
        tenant: key,
        sql: `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
              VALUES ('${TENANTS[key].id}', '${CELLS[key].review}', 'commented', 'Comentario de ejemplo')`,
      },
      {
        // The workflow writes every other kind.
        id: `approval in ${key}`,
        tenant: key,
        sql: `INSERT INTO app.review_events (tenant_id, assessment_id, kind)
              VALUES ('${TENANTS[key].id}', '${CELLS[key].review}', 'approved')`,
        rule: NOBODY,
      },
    ]),
    set: 'note = note',
    select: MEMBERS,
    insert: MEMBERS,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.reports': {
    rows: TENANT_KEYS.map((key) => ({
      id: `report to ${key}`,
      tenant: key,
      public: false,
      where: `tenant_id = '${TENANTS[key].id}'`,
      // What was sent never changes.
      blocked: { 'update:message': '23001' },
    })),
    // Only app.submit_report() writes reports, as its owner.
    inserts: TENANT_KEYS.map((key) => ({
      id: `report into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.reports (tenant_id, kind, message, anonymize_after)
            VALUES ('${TENANTS[key].id}', 'error_report', 'Mensaje de ejemplo', current_date + 1)`,
    })),
    set: `status = 'triaged'`,
    select: TRIAGERS,
    insert: NOBODY,
    update: TRIAGERS,
    delete: NOBODY,
    columnUpdates: {
      // An erasure request: every personal-data column at once.
      anonymized_at: {
        set: `name = NULL, email = NULL, organization = NULL, message = NULL, resolution_note = NULL,
              anonymized_at = now()`,
        rule: { members: ['country_admin'] },
      },
      message: { set: `message = 'Mensaje cambiado'`, rule: TRIAGERS },
      triaged_by: { set: `triaged_by = '${USERS.newcomer}'`, rule: NOBODY },
      anonymize_after: { set: 'anonymize_after = current_date', rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.report_daily_counts': {
    rows: TENANT_KEYS.map((key) => ({
      id: `report count of ${key}`,
      tenant: key,
      public: false,
      where: `tenant_id = '${TENANTS[key].id}'`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `count for ${key}`,
      tenant: key,
      sql: `INSERT INTO app.report_daily_counts (tenant_id, day, count)
            VALUES ('${TENANTS[key].id}', current_date - 1, 1)`,
    })),
    set: 'count = count + 1',
    select: NOBODY,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.assessment_revisions': {
    rows: TENANT_KEYS.map((key) => ({
      id: `revision of the published cell of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `assessment_id = '${CELLS[key].published}'`,
    })),
    // Publishing names the cell and the version reviewed; the publish trigger fills in the rest.
    inserts: TENANT_KEYS.map((key) => ({
      id: `publish the cell in review of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
            SELECT id, content_version FROM app.assessments WHERE id = '${CELLS[key].review}'`,
    })),
    set: 'reviewed_version = reviewed_version',
    select: { public: true, ...MEMBERS },
    insert: REVIEWERS,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.revision_evidence': {
    rows: TENANT_KEYS.map((key) => ({
      id: `quote of the published cell of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `revision_id IN (SELECT id FROM app.assessment_revisions WHERE assessment_id = '${CELLS[key].published}')`,
    })),
    // Written only by the publish trigger.
    inserts: TENANT_KEYS.map((key) => ({
      id: `quote into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.revision_evidence (revision_id, tenant_id, election_id, ordinal, source_document_id, quote,
                                              match_status)
            VALUES (uuidv7(), '${TENANTS[key].id}', '${CELLS[key].election.id}', 1, '${CELLS[key].source.id}',
                    '${CELLS[key].quote}', 'matched')`,
    })),
    set: 'quote = quote',
    select: { public: true, ...MEMBERS },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.revision_checked_documents': {
    rows: TENANT_KEYS.map((key) => ({
      id: `checked document of the published cell of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `revision_id IN (SELECT id FROM app.assessment_revisions WHERE assessment_id = '${CELLS[key].published}')`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `checked document into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.revision_checked_documents (revision_id, tenant_id, election_id, source_document_id,
                                                       checked_at)
            VALUES (uuidv7(), '${TENANTS[key].id}', '${CELLS[key].election.id}', '${CELLS[key].source.id}', now())`,
    })),
    set: 'checked_at = checked_at',
    select: { public: true, ...MEMBERS },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.revision_internal': {
    rows: TENANT_KEYS.map((key) => ({
      id: `internal record of the published cell of ${key}`,
      tenant: key,
      public: false,
      where: `revision_id IN (SELECT id FROM app.assessment_revisions WHERE assessment_id = '${CELLS[key].published}')`,
    })),
    inserts: TENANT_KEYS.map((key) => ({
      id: `internal record into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.revision_internal (revision_id, tenant_id, contributor_ids, reviewer_id, self_reviewed,
                                              provenance)
            VALUES (uuidv7(), '${TENANTS[key].id}', ARRAY['${USERS.editorA}'::uuid], '${USERS.reviewerA}', false,
                    '[]')`,
    })),
    set: 'self_reviewed = self_reviewed',
    select: MEMBERS,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.current_revisions': {
    view: true,
    rows: TENANT_KEYS.map((key) => ({
      id: `current revision of the published cell of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `assessment_id = '${CELLS[key].published}'`,
    })),
    inserts: [],
    set: 'revision_no = revision_no',
    select: { public: true, ...MEMBERS },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.change_requests': {
    rows: TENANT_KEYS.flatMap((key): Row[] => [
      {
        id: `pending change of ${key}`,
        tenant: key,
        public: false,
        where: `tenant_id = '${TENANTS[key].id}' AND state = 'pending'`,
      },
      {
        id: `approved change of ${key}`,
        tenant: key,
        public: false,
        where: `tenant_id = '${TENANTS[key].id}' AND state = 'approved'`,
        // Decided: it never changes, and it is never deleted.
        rules: { delete: NOBODY, 'update:state (approve)': REVIEWERS },
        blocked: { update: '23001', 'update:state (approve)': '23001' },
      },
    ]),
    inserts: TENANT_KEYS.map((key) => ({
      id: `proposal in ${key}`,
      tenant: key,
      sql: `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note)
            VALUES ('${TENANTS[key].id}', '${CELLS[key].election.id}', 'update', 'criterion',
                    '${CELLS[key].election.secondCriterion}', 'display_order', '5', '{"es": "Nota de ejemplo"}')`,
    })),
    set: `state = 'rejected'`,
    select: MEMBERS,
    insert: EDITORS,
    update: REVIEWERS,
    delete: EDITORS,
    columnUpdates: {
      'state (approve)': { set: `state = 'approved'`, rule: APPROVERS },
      decided_by: { set: `decided_by = '${USERS.newcomer}'`, rule: NOBODY },
      decided_txid: { set: 'decided_txid = pg_current_xact_id()', rule: NOBODY },
      previous_value: { set: `previous_value = '{"es": "Otro"}'`, rule: NOBODY },
      proposed_value: { set: `proposed_value = '7'`, rule: NOBODY },
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
    },
  },

  'app.structural_changes': {
    rows: TENANT_KEYS.map((key) => ({
      id: `structural change of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `tenant_id = '${TENANTS[key].id}'`,
    })),
    // Written only by the approval trigger.
    inserts: TENANT_KEYS.map((key) => ({
      id: `record of the pending change of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.structural_changes (tenant_id, election_id, change_request_id, action, target_kind,
                                               target_id, public_note)
            SELECT tenant_id, election_id, id, action, target_kind, target_id, public_note FROM app.change_requests
             WHERE tenant_id = '${TENANTS[key].id}' AND state = 'pending'`,
    })),
    set: 'field = field',
    select: { public: true, ...MEMBERS },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.corrections_log': {
    view: true,
    rows: TENANT_KEYS.map((key) => ({
      id: `logged structural change of ${key}`,
      tenant: key,
      public: isPublic(CELLS[key].election),
      where: `tenant_id = '${TENANTS[key].id}' AND entry_kind = 'structural_change'`,
    })),
    inserts: [],
    set: 'field = field',
    select: { public: true, ...MEMBERS },
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.purge_log': {
    rows: [],
    // Written only by private.purge_tenant, which only the owner runs.
    inserts: [
      {
        id: 'purge record',
        tenant: null,
        sql: `INSERT INTO app.purge_log (purged_tenant_id, purged_tenant_slug, purged_by, counts, leftovers)
              VALUES ('${TENANT_B}', 'test-b', 'aiontheballot_admin', '{}', '{}')`,
      },
    ],
    set: 'counts = counts',
    select: PLATFORM_ADMIN,
    insert: NOBODY,
    update: NOBODY,
    delete: NOBODY,
  },

  'app.memberships': {
    rows: TENANT_KEYS.map(membershipRow),
    inserts: TENANT_KEYS.map((key) => ({
      id: `editor into ${key}`,
      tenant: key,
      sql: `INSERT INTO app.memberships (user_id, tenant_id, role)
            VALUES ('${USERS.newcomer}', '${TENANTS[key].id}', 'editor')`,
    })),
    set: 'role = role',
    select: MEMBERS,
    insert: COUNTRY_ADMINS,
    update: NOBODY,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
      user_id: { set: `user_id = '${USERS.newcomer}'`, rule: NOBODY },
      created_by: { set: `created_by = '${USERS.newcomer}'`, rule: NOBODY },
    },
  },
};

/** The worker reads every column of the source its job names, including those hidden from the public. */
const columnReads = (workers: readonly string[]): Record<string, readonly string[]> =>
  Object.fromEntries(
    ['tenant_id', 'file_id', 'file_origin', 'extraction_status', 'created_by', 'created_at'].map(
      (c) => [`select:${c}`, workers],
    ),
  );

export const WORKER_ACCESS: WorkerAccess = {
  'app.tenants': { 'tenant A': { select: OPEN_JOBS } },
  'app.job_requests': {
    'fetchA job': { select: [FETCH], update: [FETCH] },
    'extractA job': { select: [EXTRACT], update: [EXTRACT] },
    'llmA job': { select: [LLM], update: [LLM] },
  },
  'app.source_documents': {
    'draftA source': { select: [FETCH], ...columnReads([FETCH]) },
    'pendingA source': {
      select: [EXTRACT],
      ...columnReads([EXTRACT]),
      'update:extraction_status': [EXTRACT],
    },
    'liveA source': { select: [LLM], ...columnReads([LLM]) },
  },
  'app.source_texts': { 'first page of liveA': { select: [LLM] } },
  'app.files': { 'sourceA file': { select: [LLM] }, 'insert upload into A': { insert: [FETCH] } },
  'app.llm_runs': { 'run of A': { select: [LLM], update: [LLM] } },
  'app.llm_suggestions': {
    'suggestion of A': { select: [LLM] },
    'insert suggestion in A': { insert: [LLM] },
  },
  'app.parties': { 'party of A live': { select: [LLM] } },
  'app.criteria': { 'criterion of A live': { select: [LLM] } },
};
