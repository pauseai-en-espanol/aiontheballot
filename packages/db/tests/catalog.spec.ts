import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { EXECUTE_ALLOWLIST, SECURITY_DEFINER_ALLOWLIST } from './allowlists.js';
import { inRolledBackTransaction, RUNTIME_ROLES } from './db.js';

const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
  inRolledBackTransaction(async (client) => (await client.query(sql, params)).rows as T[]);

describe('catalog: runtime roles', () => {
  it('exist and can never bypass RLS or manage roles and databases', async () => {
    const roles = await rows<{ rolname: string; risky: boolean }>(
      `SELECT rolname, (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS risky
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [RUNTIME_ROLES],
    );
    expect(roles.map((r) => r.rolname)).toEqual([...RUNTIME_ROLES].sort());
    expect(roles.filter((r) => r.risky)).toEqual([]);
  });

  it('are every login role of the database but its owner, so none escapes these checks', async () => {
    const logins = await rows<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
        WHERE rolcanlogin AND rolname LIKE 'aiontheballot\\_%' AND rolname <> 'aiontheballot_owner'
        ORDER BY rolname`,
    );
    expect(logins.map((r) => r.rolname)).toEqual([...RUNTIME_ROLES].sort());
  });

  it('are members of no role, so none can SET ROLE to one that reaches more (the owner, say)', async () => {
    const memberships = await rows<{ grant: string }>(
      `SELECT m.member::regrole::text || ' in ' || m.roleid::regrole::text AS grant
         FROM pg_auth_members m WHERE m.member::regrole::text = ANY($1)`,
      [RUNTIME_ROLES],
    );
    expect(memberships).toEqual([]);
  });

  it('own no schema, relation or function', async () => {
    const owned = await rows<{ kind: string; name: string }>(
      `SELECT 'schema' AS kind, nspname AS name FROM pg_namespace WHERE nspowner::regrole::text = ANY($1)
       UNION ALL
       SELECT 'relation', relname FROM pg_class WHERE relowner::regrole::text = ANY($1)
       UNION ALL
       SELECT 'function', proname FROM pg_proc WHERE proowner::regrole::text = ANY($1)`,
      [RUNTIME_ROLES],
    );
    expect(owned).toEqual([]);
  });
});

describe('catalog: closed by default', () => {
  it('lets no runtime role create in public or make temporary tables, which could shadow a name', async () => {
    const allowed = await rows<{ grant: string }>(
      `SELECT r.role || ' public CREATE' AS grant FROM unnest($1::text[]) AS r(role)
        WHERE has_schema_privilege(r.role, 'public', 'CREATE')
       UNION ALL
       SELECT r.role || ' TEMP' FROM unnest($1::text[]) AS r(role)
        WHERE has_database_privilege(r.role, current_database(), 'TEMP')`,
      [RUNTIME_ROLES],
    );
    expect(allowed).toEqual([]);
  });

  it('does not let PUBLIC connect to the database', async () => {
    const [row] = await rows<{ allowed: boolean }>(
      `SELECT has_database_privilege('public', current_database(), 'CONNECT') AS allowed`,
    );
    expect(row?.allowed).toBe(false);
  });

  it('does not let PUBLIC execute any function in app, private or auth', async () => {
    const open = await rows<{ fn: string }>(
      `SELECT n.nspname || '.' || p.proname AS fn
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private', 'auth')
          AND (p.proacl IS NULL
               OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))`,
    );
    expect(open).toEqual([]);
  });

  it('grants EXECUTE to runtime roles only as allowlisted', async () => {
    const granted = await rows<{ grant: string }>(
      `SELECT r.rolname || ' ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
              AS grant
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         CROSS JOIN LATERAL aclexplode(p.proacl) a
         JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname IN ('app', 'private', 'auth') AND a.privilege_type = 'EXECUTE' AND r.rolname = ANY($1)
        ORDER BY 1`,
      [RUNTIME_ROLES],
    );
    expect(granted.map((g) => g.grant)).toEqual([...EXECUTE_ALLOWLIST].sort());
  });

  it('pins search_path to nothing on every function, and allows only allowlisted SECURITY DEFINER functions', async () => {
    // Empty (ADR-0002 §6), not merely set: a function pinned to `public` or `app` would still resolve a name another
    // role created first.
    const functions = await rows<{ fn: string; definer: boolean; pinned: boolean }>(
      `SELECT n.nspname || '.' || p.proname AS fn, p.prosecdef AS definer,
              coalesce(p.proconfig @> ARRAY['search_path=""']
                         AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c
                                          WHERE c LIKE 'search_path=%' AND c <> 'search_path=""'), false) AS pinned
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private', 'auth')`,
    );
    expect(functions.filter((f) => !f.pinned).map((f) => f.fn)).toEqual([]);
    expect(
      functions
        .filter((f) => f.definer)
        .map((f) => f.fn)
        .sort(),
    ).toEqual([...SECURITY_DEFINER_ALLOWLIST].sort());
  });

  it('names every catalog relation with its schema in SECURITY DEFINER functions, so no temporary view stands in', async () => {
    // With search_path = '', an unqualified relation is still looked up in pg_temp first: a caller's own view there
    // would run as the function's owner.
    const definers = await rows<{ fn: string; body: string }>(
      `SELECT n.nspname || '.' || p.proname AS fn, p.prosrc AS body
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private', 'auth') AND p.prosecdef`,
    );
    const unqualified = definers.filter(({ body }) =>
      /\b(?:from|join)\s+(?!pg_catalog\.)pg_[a-z_]+\b(?!\s*\()/iu.test(body),
    );
    expect(unqualified.map(({ fn }) => fn)).toEqual([]);
  });

  it('keeps aiontheballot_auth out of app and private: no table, column, sequence or function', async () => {
    // Better Auth's role reaches only its own tables in the auth schema (ADR-0002 §2).
    const reachable = await rows<{ grant: string }>(
      `SELECT n.nspname || '.' || c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
                                 'MAINTAIN']) AS p(privilege)
        WHERE n.nspname IN ('app', 'private') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_table_privilege('aiontheballot_auth', c.oid, p.privilege)
               OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                   AND has_any_column_privilege('aiontheballot_auth', c.oid, p.privilege)))
       UNION ALL
       SELECT n.nspname || '.' || c.relname || ' ' || p.privilege
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
        WHERE n.nspname IN ('app', 'private') AND c.relkind = 'S'
          AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege('aiontheballot_auth', c.oid, p.privilege) END
       UNION ALL
       SELECT n.nspname || '.' || p.proname || ' EXECUTE'
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private') AND has_function_privilege('aiontheballot_auth', p.oid, 'EXECUTE')
       UNION ALL
       SELECT nspname || ' ' || p.privilege FROM pg_namespace CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
        WHERE nspname IN ('app', 'private') AND has_schema_privilege('aiontheballot_auth', oid, p.privilege)`,
    );
    expect(reachable).toEqual([]);
  });

  it('keeps aiontheballot_sweeper to its one function: no table, column, sequence or other function (PLAN R141)', async () => {
    // The scheduled sweep's login reads the list of named files through private.file_sweep_list() and nothing else.
    const reachable = await rows<{ grant: string }>(
      `SELECT n.nspname || '.' || c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
                                 'MAINTAIN']) AS p(privilege)
        WHERE n.nspname IN ('app', 'private', 'auth') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_table_privilege('aiontheballot_sweeper', c.oid, p.privilege)
               OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                   AND has_any_column_privilege('aiontheballot_sweeper', c.oid, p.privilege)))
       UNION ALL
       SELECT n.nspname || '.' || c.relname || ' ' || p.privilege
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
        WHERE n.nspname IN ('app', 'private', 'auth') AND c.relkind = 'S'
          AND has_sequence_privilege('aiontheballot_sweeper', c.oid, p.privilege)
       UNION ALL
       SELECT n.nspname || '.' || p.proname || ' EXECUTE'
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private', 'auth')
          AND has_function_privilege('aiontheballot_sweeper', p.oid, 'EXECUTE')
       UNION ALL
       SELECT nspname || ' ' || p.privilege FROM pg_namespace CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
        WHERE nspname IN ('app', 'private', 'auth') AND has_schema_privilege('aiontheballot_sweeper', oid, p.privilege)`,
    );
    expect(reachable.map((r) => r.grant).sort()).toEqual([
      'private USAGE',
      'private.file_sweep_list EXECUTE',
    ]);
    const [database] = await rows<{ create: boolean }>(
      `SELECT has_database_privilege('aiontheballot_sweeper', current_database(), 'CREATE') AS create`,
    );
    expect(database?.create).toBe(false);
  });

  it("keeps every other runtime role, and PUBLIC, out of auth: Better Auth's credentials (ADR-0002 §2)", async () => {
    const others = ['public', ...RUNTIME_ROLES.filter((role) => role !== 'aiontheballot_auth')];
    const reachable = await rows<{ grant: string }>(
      `SELECT r.role || ' ' || n.nspname || '.' || c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS r(role)
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
                                 'MAINTAIN']) AS p(privilege)
        WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND (has_table_privilege(r.role, c.oid, p.privilege)
               OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                   AND has_any_column_privilege(r.role, c.oid, p.privilege)))
       UNION ALL
       SELECT r.role || ' ' || n.nspname || '.' || c.relname || ' ' || p.privilege
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS r(role)
         CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
        WHERE n.nspname = 'auth' AND c.relkind = 'S'
          AND CASE WHEN c.relkind = 'S' THEN has_sequence_privilege(r.role, c.oid, p.privilege) END
       UNION ALL
       SELECT r.role || ' ' || n.nspname || '.' || f.proname || ' EXECUTE'
         FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
         CROSS JOIN unnest($1::text[]) AS r(role)
        WHERE n.nspname = 'auth' AND has_function_privilege(r.role, f.oid, 'EXECUTE')
       UNION ALL
       SELECT r.role || ' auth ' || p.privilege
         FROM unnest($1::text[]) AS r(role)
         CROSS JOIN unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
        WHERE has_schema_privilege(r.role, 'auth', p.privilege)`,
      [others],
    );
    expect(reachable).toEqual([]);
  });

  it('gives aiontheballot_auth exactly what Better Auth does with its tables, and no default grants anywhere', async () => {
    const granted = await rows<{ grant: string }>(
      `SELECT c.relname || ' ' || string_agg(p.privilege, ',' ORDER BY p.privilege) AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER',
                                 'MAINTAIN']) AS p(privilege)
        WHERE n.nspname = 'auth' AND c.relkind IN ('r', 'p')
          AND has_table_privilege('aiontheballot_auth', c.oid, p.privilege)
        GROUP BY c.relname ORDER BY 1`,
    );
    expect(granted.map((g) => g.grant)).toEqual([
      ...['accounts'].map((table) => `${table} DELETE,INSERT,SELECT,UPDATE`),
      // A member's tokens (ADR-0008): minted and read, then only marked used or revoked, never deleted.
      'member_tokens INSERT,SELECT',
      // Passkeys (PLAN D22) are Better Auth's too, from its passkey plugin.
      ...['passkeys', 'rate_limits', 'sessions', 'two_factors', 'users', 'verifications'].map(
        (table) => `${table} DELETE,INSERT,SELECT,UPDATE`,
      ),
    ]);
    expect(
      await rows<{ column: string }>(
        `SELECT a.attname AS column FROM pg_attribute a
          WHERE a.attrelid = 'auth.member_tokens'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND has_column_privilege('aiontheballot_auth', a.attrelid, a.attnum, 'UPDATE')
          ORDER BY 1`,
      ),
    ).toEqual([{ column: 'last_used_at' }, { column: 'revoked_at' }]);
    const [schema] = await rows<{ create: boolean }>(
      `SELECT has_schema_privilege('aiontheballot_auth', 'auth', 'CREATE') AS create`,
    );
    expect(schema?.create).toBe(false);
    // A default privilege for anyone but the owner would hand them every future table or function.
    expect(
      await rows(
        `SELECT d.defaclrole::regrole::text AS creator, d.defaclobjtype AS kind, x.grantee::regrole::text AS grantee
           FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x
          WHERE x.grantee <> d.defaclrole`,
      ),
    ).toEqual([]);
  });

  // The public site's role, and the preview's (PLAN R181), which reads what it reads and the elections in preview.
  for (const reader of ['aiontheballot_web', 'aiontheballot_preview']) {
    it(`gives ${reader} no way to write any table`, async () => {
      const writable = await rows<{ grant: string }>(
        `SELECT c.relname || ' ' || p.privilege AS grant
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
          WHERE n.nspname IN ('app', 'auth') AND c.relkind IN ('r', 'p', 'v')
            AND (has_table_privilege($1, c.oid, p.privilege)
                 OR (p.privilege IN ('INSERT', 'UPDATE')
                     AND has_any_column_privilege($1, c.oid, p.privilege)))`,
        [reader],
      );
      expect(writable).toEqual([]);
    });

    it(`keeps ${reader} to app: it reaches private's helpers only through app's definer functions`, async () => {
      // Its policies and the views it reads call nothing in private, and app's four functions run as their owner.
      const schemas = await rows<{ schema: string }>(
        `SELECT nspname AS schema FROM pg_namespace
          WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
            AND has_schema_privilege($1, oid, 'USAGE')
          ORDER BY 1`,
        [reader],
      );
      expect(schemas.map((s) => s.schema)).toEqual(['app']);
    });
  }

  it('lets aiontheballot_preview read exactly the columns aiontheballot_web reads (PLAN R181)', async () => {
    const differing = await rows<{ column: string }>(
      `SELECT c.relname || '.' || a.attname || ' ' || has_column_privilege('aiontheballot_web', c.oid, a.attnum, 'SELECT')
              AS column
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname IN ('app', 'auth', 'private') AND c.relkind IN ('r', 'p', 'v', 'm')
          AND has_column_privilege('aiontheballot_web', c.oid, a.attnum, 'SELECT')
              <> has_column_privilege('aiontheballot_preview', c.oid, a.attnum, 'SELECT')
        ORDER BY 1`,
    );
    expect(differing).toEqual([]);
  });

  it('gives aiontheballot_preview a read policy wherever aiontheballot_web has one, and nothing else (PLAN R181)', async () => {
    const policies = await rows<{ policy: string }>(
      `SELECT tablename || ' ' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') AS policy
         FROM pg_policies
        WHERE schemaname = 'app' AND roles && ARRAY['aiontheballot_web', 'aiontheballot_preview']::name[]
        ORDER BY tablename, policyname`,
    );
    const byTable = new Map<string, string[]>();
    for (const { policy } of policies) {
      const [table = '', ...rest] = policy.split(' ');
      byTable.set(table, [...(byTable.get(table) ?? []), rest.join(' ')]);
    }
    const mismatched = [...byTable].filter(
      ([, found]) =>
        JSON.stringify(found) !==
        JSON.stringify([
          'preview_read SELECT aiontheballot_preview',
          'public_read SELECT aiontheballot_web',
        ]),
    );
    expect(mismatched).toEqual([]);
    expect(byTable.size).toBeGreaterThan(0);
  });

  it('never grants TRUNCATE (which skips RLS), REFERENCES, TRIGGER or MAINTAIN to a runtime role', async () => {
    const risky = await rows<{ grant: string }>(
      `SELECT r.role || ' ' || c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS r(role)
         CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) AS p(privilege)
        WHERE n.nspname IN ('app', 'auth') AND c.relkind IN ('r', 'p', 'v')
          AND (has_table_privilege(r.role, c.oid, p.privilege)
               OR (p.privilege = 'REFERENCES' AND has_any_column_privilege(r.role, c.oid, p.privilege)))`,
      [RUNTIME_ROLES],
    );
    expect(risky).toEqual([]);
  });

  it('grants PUBLIC nothing on any table or column', async () => {
    const open = await rows<{ relname: string }>(
      `SELECT DISTINCT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
        WHERE n.nspname IN ('app', 'private', 'auth')
          AND (EXISTS (SELECT 1 FROM aclexplode(c.relacl) x WHERE x.grantee = 0)
               OR EXISTS (SELECT 1 FROM aclexplode(a.attacl) x WHERE x.grantee = 0))`,
    );
    expect(open).toEqual([]);
  });
});

/**
 * Tenant ownership (ADR-0002 §4): every table with a tenant_id has the immutability trigger, at least one foreign key
 * that pins tenant_id (to app.tenants or a tenant-owned parent), and no foreign key to a tenant-owned parent that
 * leaves tenant_id out or maps it to another column. Returns one line per violation.
 */
const tenantOwnershipViolations = async (client: pg.Client): Promise<string[]> => {
  const tables = (
    await client.query<{ name: string; immutable: boolean }>(
      `SELECT c.relname AS name,
              EXISTS (SELECT 1 FROM pg_trigger t
                       WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                         AND t.tgfoid = to_regprocedure('private.forbid_tenant_change()')
                         AND (t.tgtype & 19) = 19) AS immutable
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
        ORDER BY 1`,
    )
  ).rows;
  const keys = (
    await client.query<{
      name: string;
      ref: string;
      cols: string[];
      refcols: string[];
      tenantOwned: boolean;
    }>(
      `SELECT c.relname AS name, r.relname AS ref,
              ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(num, ord)
                      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num ORDER BY k.ord) AS cols,
              ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(num, ord)
                      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num ORDER BY k.ord) AS refcols,
              EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = r.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) AS "tenantOwned"
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class r ON r.oid = con.confrelid
        WHERE con.contype = 'f' AND n.nspname = 'app'`,
    )
  ).rows;

  return tables.flatMap(({ name, immutable }) => {
    const violations: string[] = [];
    if (!immutable) {
      violations.push(`${name}: no BEFORE UPDATE private.forbid_tenant_change() trigger`);
    }
    const own = keys.filter((k) => k.name === name);
    const pins = (k: (typeof own)[number]): boolean => {
      const i = k.cols.indexOf('tenant_id');
      return k.ref === 'tenants'
        ? k.cols.length === 1 && i === 0 && k.refcols[0] === 'id'
        : i >= 0 && k.refcols[i] === 'tenant_id';
    };
    for (const k of own.filter((k) => (k.ref === 'tenants' || k.tenantOwned) && !pins(k))) {
      violations.push(
        `${name}: foreign key (${k.cols.join(', ')}) → ${k.ref} does not pin tenant_id`,
      );
    }
    if (!own.some((k) => (k.ref === 'tenants' || k.tenantOwned) && pins(k))) {
      violations.push(`${name}: tenant_id is not pinned by any foreign key`);
    }
    return violations;
  });
};

describe('catalog: tenant ownership', () => {
  it('holds for every table with a tenant_id', async () => {
    expect(await inRolledBackTransaction(tenantOwnershipViolations)).toEqual([]);
  });

  it('reports a missing trigger, an unpinned tenant_id, and a foreign key that skips it', async () => {
    const violations = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe_parent (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenants,
                                       UNIQUE (tenant_id, id));
        CREATE TRIGGER forbid_tenant_change BEFORE UPDATE ON app.probe_parent
          FOR EACH ROW EXECUTE FUNCTION private.forbid_tenant_change();
        CREATE TABLE app.probe_loose (id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
                                      parent_id uuid REFERENCES app.probe_parent);`);
      return tenantOwnershipViolations(client);
    });
    expect(violations).toEqual([
      'probe_loose: no BEFORE UPDATE private.forbid_tenant_change() trigger',
      'probe_loose: foreign key (parent_id) → probe_parent does not pin tenant_id',
      'probe_loose: tenant_id is not pinned by any foreign key',
    ]);
  });
});

const ACCOUNT_ID = 'an account id (auth.users, which no app table references)';

/**
 * `table.column` uuid references in tenant tables that no foreign key pins to the row's tenant, and why that is safe.
 * Adding one is a design decision: say in the reason what keeps it inside the tenant (PLAN R168).
 */
const UNPINNED_ID_COLUMNS: Readonly<Record<string, string>> = {
  'assessment_contributors.user_id': ACCOUNT_ID,
  'assessments.updated_by': ACCOUNT_ID,
  'audit_log.actor_id': ACCOUNT_ID,
  'audit_log.token_id':
    "a member token's id (auth.member_tokens, which no app table references; ADR-0008)",
  'brand_asset_grants.granted_by': ACCOUNT_ID,
  'change_requests.decided_by': ACCOUNT_ID,
  'change_requests.proposed_by': ACCOUNT_ID,
  'draft_checked_documents.checked_by': ACCOUNT_ID,
  'draft_evidence.attested_by': ACCOUNT_ID,
  'draft_evidence.created_by': ACCOUNT_ID,
  'files.created_by': ACCOUNT_ID,
  'invitations.accepted_by': ACCOUNT_ID,
  'invitations.created_by': ACCOUNT_ID,
  'job_requests.requested_by': ACCOUNT_ID,
  'llm_runs.requested_by': ACCOUNT_ID,
  'llm_suggestions.decided_by': ACCOUNT_ID,
  'memberships.created_by': ACCOUNT_ID,
  'memberships.user_id': ACCOUNT_ID,
  'reports.triaged_by': ACCOUNT_ID,
  'review_events.actor_id': ACCOUNT_ID,
  'revision_internal.contributor_ids': 'account ids (auth.users), copied by the publish trigger',
  'revision_internal.reviewer_id': ACCOUNT_ID,
  'source_documents.created_by': ACCOUNT_ID,
  'tenant_documents.created_by': ACCOUNT_ID,
  'change_requests.target_id':
    "private.change_request_rules (as the writer) finds the target_kind row it names in the request's election",
  'structural_changes.target_id':
    "inserted only from a trigger (its RLS policy): the approval trigger's request target, or the row the request added",
};

/** Tables with no tenant that a tenant's rows may reference: shared by every tenant, and readable as such. */
const SHARED_TABLES: readonly string[] = ['core_criteria', 'organizations', 'brand_assets'];

/**
 * Every uuid or uuid[] column of a tenant table but `id` and `tenant_id` (domains over them included) is in an
 * enforced, validated foreign key that pins tenant_id to a tenant-owned parent's, or in one to a shared table
 * (SHARED_TABLES), unless listed in UNPINNED_ID_COLUMNS. A reference with no such key could name another tenant's row.
 * Returns one line per violation, and one per listed column that no longer needs listing.
 */
const unpinnedIdColumns = async (client: pg.Client): Promise<string[]> => {
  const columns = (
    await client.query<{ name: string; col: string; covered: boolean }>(
      `WITH RECURSIVE base (oid, base) AS (
         SELECT t.oid, t.oid FROM pg_type t WHERE t.typtype <> 'd'
         UNION ALL
         SELECT d.oid, b.base FROM pg_type d JOIN base b ON b.oid = d.typbasetype WHERE d.typtype = 'd'
       ), tenant_tables AS (
         SELECT c.oid, c.relname FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
          WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
       )
       SELECT t.relname AS name, a.attname AS col,
              EXISTS (
                SELECT 1 FROM pg_constraint con
                  JOIN pg_class r ON r.oid = con.confrelid
                  JOIN pg_namespace rn ON rn.oid = r.relnamespace
                 WHERE con.contype = 'f' AND con.conenforced AND con.convalidated
                   AND con.conrelid = t.oid AND a.attnum = ANY (con.conkey)
                   AND rn.nspname = 'app'
                   AND CASE
                         WHEN r.relname = ANY ($1) THEN true
                         WHEN EXISTS (SELECT 1 FROM pg_attribute ra
                                       WHERE ra.attrelid = r.oid AND ra.attname = 'tenant_id' AND NOT ra.attisdropped)
                           -- A tenant-owned parent: tenant_id maps to its tenant_id.
                           THEN EXISTS (SELECT 1 FROM unnest(con.conkey, con.confkey) k(col, refcol)
                                          JOIN pg_attribute ka ON ka.attrelid = con.conrelid AND ka.attnum = k.col
                                          JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = k.refcol
                                         WHERE ka.attname = 'tenant_id' AND ra.attname = 'tenant_id')
                         ELSE false
                       END
              ) AS covered
         FROM tenant_tables t
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
         JOIN base b ON b.oid = a.atttypid
         LEFT JOIN pg_type bt ON bt.oid = b.base
        WHERE (b.base = 'uuid'::regtype OR bt.typelem = 'uuid'::regtype)
          AND a.attname NOT IN ('id', 'tenant_id')
        ORDER BY 1, 2`,
      [SHARED_TABLES],
    )
  ).rows;
  const unpinned = columns.filter((c) => !c.covered).map((c) => `${c.name}.${c.col}`);
  return [
    ...unpinned
      .filter((c) => !(c in UNPINNED_ID_COLUMNS))
      .map((c) => `${c}: no foreign key pins it to the row's tenant`),
    ...Object.keys(UNPINNED_ID_COLUMNS)
      .filter((c) => !unpinned.includes(c))
      .map((c) => `${c}: listed as unpinned, but it is pinned or gone`),
  ];
};

describe('catalog: uuid references in tenant tables', () => {
  it("are pinned to the row's tenant by a foreign key, or listed with a reason", async () => {
    expect(await inRolledBackTransaction(unpinnedIdColumns)).toEqual([]);
  });

  it('reports a reference no enforced key pins, and passes a pinned one or one to a shared table', async () => {
    const violations = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe_parent (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES app.tenants,
                                       UNIQUE (tenant_id, id));
        CREATE DOMAIN app.probe_uuid AS uuid;
        CREATE DOMAIN app.probe_deeper AS app.probe_uuid;
        CREATE TABLE app.probe_refs (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL REFERENCES app.tenants,
          pinned_id uuid,
          FOREIGN KEY (tenant_id, pinned_id) REFERENCES app.probe_parent (tenant_id, id),
          unenforced_id uuid,
          FOREIGN KEY (tenant_id, unenforced_id) REFERENCES app.probe_parent (tenant_id, id) NOT ENFORCED,
          unvalidated_id uuid,
          loose_id uuid,
          deep app.probe_deeper,
          many uuid[],
          skipping_id uuid REFERENCES app.probe_parent,
          other_tenant_id uuid REFERENCES app.tenants,
          admin_id uuid REFERENCES app.platform_admins,
          organization_id uuid REFERENCES app.organizations,
          note_id text
        );
        ALTER TABLE app.probe_refs ADD FOREIGN KEY (tenant_id, unvalidated_id)
          REFERENCES app.probe_parent (tenant_id, id) NOT VALID;`);
      return unpinnedIdColumns(client);
    });
    expect(violations).toEqual([
      "probe_refs.admin_id: no foreign key pins it to the row's tenant",
      "probe_refs.deep: no foreign key pins it to the row's tenant",
      "probe_refs.loose_id: no foreign key pins it to the row's tenant",
      "probe_refs.many: no foreign key pins it to the row's tenant",
      "probe_refs.other_tenant_id: no foreign key pins it to the row's tenant",
      "probe_refs.skipping_id: no foreign key pins it to the row's tenant",
      "probe_refs.unenforced_id: no foreign key pins it to the row's tenant",
      "probe_refs.unvalidated_id: no foreign key pins it to the row's tenant",
    ]);
  });
});

/** Actor columns and event timestamps set when a row is inserted (data model spec §1). */
const STAMPED_ON_INSERT = [
  'created_by',
  'proposed_by',
  'requested_by',
  'granted_by',
  'checked_by',
  'actor_id',
  'created_at',
  'proposed_at',
  'checked_at',
  'granted_at',
  'approved_at',
  'published_at',
  'first_edit_at',
];
/** Set on every insert and update. Columns set on a later transition are covered by the data-rule tests. */
const STAMPED_ALWAYS = ['updated_by', 'updated_at'];
/** `table.column` pairs that look stamped but are set elsewhere (copied, or on a later transition), and why. */
const NOT_STAMPED: Readonly<Record<string, string>> = {
  'tenant_documents.published_at': 'set when a draft is published, by the rules trigger',
  'revision_checked_documents.checked_at': "copied from the draft's check by the publish trigger",
};

const ROW = 1;
const BEFORE = 2;
const INSERT = 4;
const UPDATE = 16;

/** Every `table.column` in app that should be stamped by a BEFORE ROW `private.stamp` trigger but isn't. */
const missingStamps = async (client: pg.Client): Promise<string[]> => {
  const columns = (
    await client.query<{ name: string; col: string }>(
      `SELECT c.relname AS name, a.attname AS col
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attname = ANY($1)
        ORDER BY 1, 2`,
      [[...STAMPED_ON_INSERT, ...STAMPED_ALWAYS]],
    )
  ).rows;
  const triggers = (
    await client.query<{ name: string; type: number; args: Buffer }>(
      `SELECT c.relname AS name, t.tgtype AS type, t.tgargs AS args
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND NOT t.tgisinternal AND t.tgfoid = to_regprocedure('private.stamp()')`,
    )
  ).rows.map((t) => ({ ...t, args: t.args.toString('utf8').split('\0').filter(Boolean) }));

  return columns
    .filter(({ name, col }) => !(`${name}.${col}` in NOT_STAMPED))
    .filter(({ name, col }) => {
      const events = INSERT | (STAMPED_ALWAYS.includes(col) ? UPDATE : 0);
      return !triggers.some(
        (t) =>
          t.name === name &&
          t.args.includes(col) &&
          (t.type & (ROW | BEFORE)) === (ROW | BEFORE) &&
          (t.type & events) === events,
      );
    })
    .map(({ name, col }) => `${name}.${col}`);
};

describe('catalog: actor columns and event timestamps', () => {
  it('are all set by a private.stamp trigger', async () => {
    expect(await inRolledBackTransaction(missingStamps)).toEqual([]);
  });

  it('are reported when a table forgets the trigger, or stamps updated_by on insert only', async () => {
    const missing = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.unstamped (id int PRIMARY KEY, created_by uuid);
        CREATE TABLE app.half_stamped (id int PRIMARY KEY, created_at timestamptz, updated_by uuid);
        CREATE TRIGGER stamp BEFORE INSERT ON app.half_stamped
          FOR EACH ROW EXECUTE FUNCTION private.stamp('created_at', 'updated_by');
        CREATE TABLE app.stamped (id int PRIMARY KEY, created_by uuid, updated_at timestamptz);
        CREATE TRIGGER stamp BEFORE INSERT OR UPDATE ON app.stamped
          FOR EACH ROW EXECUTE FUNCTION private.stamp('created_by', 'updated_at');`);
      return missingStamps(client);
    });
    expect(missing).toEqual(['half_stamped.updated_by', 'unstamped.created_by']);
  });
});

describe('catalog: tables', () => {
  it('enables RLS on every table in app', async () => {
    const unprotected = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`,
    );
    expect(unprotected).toEqual([]);
  });

  it('has no materialized views, and only security_invoker views, in app', async () => {
    const offenders = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app'
          AND (c.relkind = 'm'
               OR (c.relkind = 'v' AND NOT coalesce('security_invoker=true' = ANY(c.reloptions), false)))`,
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the private schema free of tables and views', async () => {
    const relations = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'private' AND c.relkind IN ('r', 'p', 'v', 'm')`,
    );
    expect(relations).toEqual([]);
  });

  it("stores no file bytes: those live on the file volume, in their row's tenant and bucket (ADR-0004)", async () => {
    const binary = await rows<{ column: string }>(
      `SELECT c.table_name || '.' || c.column_name AS column FROM information_schema.columns c
        WHERE c.table_schema IN ('app', 'private') AND c.data_type = 'bytea'`,
    );
    expect(binary).toEqual([]);
  });
});

/** Tables written without an audit trigger, and why. Every other table in app must have one. */
const NOT_AUDITED: Readonly<Record<string, string>> = {
  audit_log: 'the log itself',
  source_texts:
    "extracted text, written by the extraction job; the source's status change is audited",
  public_versions: 'a counter moved only by triggers, whose writes are audited themselves',
  report_daily_counts: 'a counter moved only by app.submit_report, whose reports are audited',
  signup_daily_counts: 'a counter moved only by app.sign_up, whose signups are audited',
  purge_log: "the record of a purge, which removes the tenant's audit rows with it",
};

/** Tables in app whose rows are never updated or deleted (ADR-0002 §14), except by purge_tenant. */
const IMMUTABLE = [
  'assessment_revisions',
  'audit_log',
  'hostname_tombstones',
  'purge_log',
  'review_events',
  'revision_checked_documents',
  'revision_evidence',
  'revision_internal',
  'source_texts',
  'structural_changes',
];

/** Columns commented `personal data` (spec §1), as `table.column`: the audit trigger never logs them. */
/** Better Auth's, in `auth` (migration auth_schema): it has no audit trigger, but the marks still say what is. */
const AUTH_PERSONAL_DATA: readonly string[] = [
  'auth.passkeys.name',
  'auth.rate_limits.key',
  'auth.sessions.ip_address',
  'auth.sessions.user_agent',
  'auth.users.email',
  'auth.users.image',
  'auth.users.name',
];

const PERSONAL_DATA: readonly string[] = [
  'files.original_filename',
  'invitations.email',
  'methodology_reviewers.name',
  'reports.email',
  'reports.message',
  'reports.name',
  'reports.organization',
  'reports.resolution_note',
  'signups.email',
  'signups.mailbox',
  'signups.token_hash',
  'change_requests.previous_value',
  'change_requests.proposed_value',
  'structural_changes.new_value',
  'structural_changes.previous_value',
];

const DELETE = 8;
const TRUNCATE = 32;

/** Every table in app without an AFTER ROW private.audit() trigger on insert, update and delete, unless listed. */
const unaudited = async (client: pg.Client): Promise<string[]> =>
  (
    await client.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('private.audit()')
                             AND (t.tgtype & ${ROW | BEFORE}) = ${ROW}
                             AND (t.tgtype & ${INSERT | UPDATE | DELETE}) = ${INSERT | UPDATE | DELETE})
        ORDER BY 1`,
    )
  ).rows
    .map((r) => r.name)
    .filter((name) => !(name in NOT_AUDITED));

describe('catalog: audit', () => {
  it('audits every table but the listed ones', async () => {
    expect(await inRolledBackTransaction(unaudited)).toEqual([]);
  });

  it('reports a table without the trigger, or audited on some operations only', async () => {
    const missing = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe_silent (id int PRIMARY KEY);
        CREATE TABLE app.probe_partial (id int PRIMARY KEY);
        CREATE TRIGGER audit AFTER INSERT OR UPDATE ON app.probe_partial
          FOR EACH ROW EXECUTE FUNCTION private.audit();`);
      return unaudited(client);
    });
    expect(missing).toEqual(['probe_partial', 'probe_silent']);
  });

  it('marks exactly the personal-data columns of the spec', async () => {
    const marked = await rows<{ col: string }>(
      `SELECT CASE n.nspname WHEN 'app' THEN '' ELSE n.nspname || '.' END || c.relname || '.' || a.attname AS col
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
        WHERE n.nspname IN ('app', 'auth') AND d.description = 'personal data'
        ORDER BY 1`,
    );
    expect(marked.map((m) => m.col)).toEqual([...PERSONAL_DATA, ...AUTH_PERSONAL_DATA].sort());
  });

  it('protects every immutable table with UPDATE, DELETE and TRUNCATE triggers', async () => {
    const triggers = await rows<{ name: string; type: number }>(
      `SELECT c.relname AS name, t.tgtype AS type
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND NOT t.tgisinternal
          AND t.tgfoid = to_regprocedure('private.forbid_mutation()') AND (t.tgtype & ${BEFORE}) = ${BEFORE}`,
    );
    const covers = (name: string, events: number, row: boolean): boolean =>
      triggers.some(
        (t) => t.name === name && (t.type & events) === events && ((t.type & ROW) === ROW) === row,
      );
    expect(
      IMMUTABLE.filter(
        (name) => !covers(name, UPDATE | DELETE, true) || !covers(name, TRUNCATE, false),
      ),
    ).toEqual([]);
  });
});

/** Public-capable tables (readable by aiontheballot_web) whose writes don't bump the public cache key, and why. */
const NOT_BUMPED: Readonly<Record<string, string>> = {
  public_versions: 'the counter itself',
};

/** Every table aiontheballot_web can read without an AFTER ROW bump trigger on insert, update and delete. */
const unbumped = async (client: pg.Client): Promise<string[]> =>
  (
    await client.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p')
          AND has_any_column_privilege('aiontheballot_web', c.oid, 'SELECT')
          AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                           WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                             AND t.tgfoid = to_regprocedure('private.bump_public_version()')
                             AND (t.tgtype & ${ROW | BEFORE}) = ${ROW}
                             AND (t.tgtype & ${INSERT | UPDATE | DELETE}) = ${INSERT | UPDATE | DELETE})
        ORDER BY 1`,
    )
  ).rows
    .map((r) => r.name)
    .filter((name) => !(name in NOT_BUMPED));

describe('catalog: public cache key', () => {
  it('is bumped by every table the public can read', async () => {
    expect(await inRolledBackTransaction(unbumped)).toEqual([]);
  });

  it('reports a public table without the trigger, but not a private one', async () => {
    const missing = await inRolledBackTransaction(async (client) => {
      await client.query(`
        CREATE TABLE app.probe_public (id int PRIMARY KEY, tenant_id uuid);
        GRANT SELECT (id) ON app.probe_public TO aiontheballot_web;
        CREATE TABLE app.probe_private (id int PRIMARY KEY, tenant_id uuid);`);
      return unbumped(client);
    });
    expect(missing).toEqual(['probe_public']);
  });
});
