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
  /** Rules that differ for this row's state (say, a draft row may be deleted and a published one not). */
  rules?: Partial<Record<'select' | 'update' | 'delete', Rule>>;
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
