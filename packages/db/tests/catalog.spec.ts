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
  it('does not let PUBLIC connect to the database', async () => {
    const [row] = await rows<{ allowed: boolean }>(
      `SELECT has_database_privilege('public', current_database(), 'CONNECT') AS allowed`,
    );
    expect(row?.allowed).toBe(false);
  });

  it('does not let PUBLIC execute any function in app or private', async () => {
    const open = await rows<{ fn: string }>(
      `SELECT n.nspname || '.' || p.proname AS fn
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private')
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
        WHERE n.nspname IN ('app', 'private') AND a.privilege_type = 'EXECUTE' AND r.rolname = ANY($1)
        ORDER BY 1`,
      [RUNTIME_ROLES],
    );
    expect(granted.map((g) => g.grant)).toEqual([...EXECUTE_ALLOWLIST].sort());
  });

  it('pins search_path on every function, and allows only allowlisted SECURITY DEFINER functions', async () => {
    const functions = await rows<{ fn: string; definer: boolean; pinned: boolean }>(
      `SELECT n.nspname || '.' || p.proname AS fn, p.prosecdef AS definer,
              coalesce(EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'), false) AS pinned
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app', 'private')`,
    );
    expect(functions.filter((f) => !f.pinned).map((f) => f.fn)).toEqual([]);
    expect(
      functions
        .filter((f) => f.definer)
        .map((f) => f.fn)
        .sort(),
    ).toEqual([...SECURITY_DEFINER_ALLOWLIST].sort());
  });

  it('gives aiontheballot_web no way to write any table', async () => {
    const writable = await rows<{ grant: string }>(
      `SELECT c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v')
          AND (has_table_privilege('aiontheballot_web', c.oid, p.privilege)
               OR (p.privilege IN ('INSERT', 'UPDATE')
                   AND has_any_column_privilege('aiontheballot_web', c.oid, p.privilege)))`,
    );
    expect(writable).toEqual([]);
  });

  it('never grants TRUNCATE (which skips RLS), REFERENCES or TRIGGER to a runtime role', async () => {
    const risky = await rows<{ grant: string }>(
      `SELECT r.role || ' ' || c.relname || ' ' || p.privilege AS grant
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($1::text[]) AS r(role)
         CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
        WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v')
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
        WHERE n.nspname IN ('app', 'private')
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
});

/** Tables written without an audit trigger, and why. Every other table in app must have one. */
const NOT_AUDITED: Readonly<Record<string, string>> = {
  audit_log: 'the log itself',
  file_blobs: 'the bytes of a file, whose metadata row is audited',
  source_texts:
    "extracted text, written by the extraction job; the source's status change is audited",
  public_versions: 'a counter moved only by triggers, whose writes are audited themselves',
  report_daily_counts: 'a counter moved only by app.submit_report, whose reports are audited',
};

/** Tables in app whose rows are never updated or deleted (ADR-0002 §14), except by purge_tenant. */
const IMMUTABLE = [
  'assessment_revisions',
  'audit_log',
  'hostname_tombstones',
  'review_events',
  'revision_checked_documents',
  'revision_evidence',
  'revision_internal',
  'source_texts',
];

/** Columns commented `personal data` (spec §1), as `table.column`: the audit trigger never logs them. */
const PERSONAL_DATA: readonly string[] = [
  'files.original_filename',
  'invitations.email',
  'methodology_reviewers.name',
  'reports.email',
  'reports.message',
  'reports.name',
  'reports.organization',
  'reports.resolution_note',
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
      `SELECT c.relname || '.' || a.attname AS col
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
        WHERE n.nspname = 'app' AND d.description = 'personal data'
        ORDER BY 1`,
    );
    expect(marked.map((m) => m.col)).toEqual([...PERSONAL_DATA].sort());
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
  hostname_tombstones: 'platform-wide, with no tenant to bump; routing data has its own refresh',
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
