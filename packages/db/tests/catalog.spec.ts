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
    expect(functions.filter((f) => f.definer).map((f) => f.fn)).toEqual([
      ...SECURITY_DEFINER_ALLOWLIST,
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
/** `table.column` pairs that look stamped but are copied from another row instead, with the reason. */
const NOT_STAMPED: Readonly<Record<string, string>> = {};

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
