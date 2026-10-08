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
