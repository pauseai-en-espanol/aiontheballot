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
  { id: 'worker for A', role: 'aiontheballot_worker', jobTenantId: TENANT_A },
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
  blocked?: Partial<Record<'update' | 'delete', string>>;
}

export interface Insert {
  id: string;
  tenant: TenantKey | null;
  sql: string;
}

export interface Relation {
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

const tenantRow = (key: TenantKey): Row => ({
  id: `tenant ${key}`,
  tenant: key,
  public: TENANTS[key].active,
  where: `id = '${TENANTS[key].id}'`,
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
        sql: `INSERT INTO app.brand_assets (name, content_type, sha256, content)
              VALUES ('Logo nuevo de ejemplo', 'image/png', encode(sha256('\\x89504e47'::bytea), 'hex'),
                      '\\x89504e47'::bytea)`,
      },
    ],
    set: `name = name || ' v2'`,
    select: { public: true, ...MEMBERS },
    insert: PLATFORM_ADMIN,
    update: PLATFORM_ADMIN,
    delete: PLATFORM_ADMIN,
    columnUpdates: {
      content: { set: `content = '\\x00'::bytea`, rule: NOBODY },
      sha256: { set: `sha256 = encode(sha256('\\x00'::bytea), 'hex')`, rule: NOBODY },
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
    ],
    inserts: TENANT_KEYS.map((key) => ({
      id: `footer mark of ${key}`,
      tenant: key,
      sql: `INSERT INTO app.tenant_brand_selections (tenant_id, slot, brand_asset_id)
            VALUES ('${TENANTS[key].id}', 'footer_mark', '${BRAND_ASSETS.shared.id}')`,
    })),
    set: 'brand_asset_id = brand_asset_id',
    select: { public: true, ...MEMBERS },
    insert: COUNTRY_ADMINS,
    update: COUNTRY_ADMINS,
    delete: COUNTRY_ADMINS,
    columnUpdates: {
      tenant_id: { set: `tenant_id = '${TENANT_B}'`, rule: NOBODY },
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
