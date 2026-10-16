import type pg from 'pg';

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { inRolledBackTransaction } from './db.js';
import { BRAND_ASSETS, ELECTIONS, ORGANIZATIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

/**
 * The export of one site (scripts/export-tenant.sql; runbook docs/runbooks/exporting-a-site.md): its query, as the
 * script runs it in psql, run here as the superuser on the matrix fixtures.
 */
const SCRIPT = new URL('../../../scripts/export-tenant.sql', import.meta.url);

const between = (text: string, start: string, end: string): string => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from === -1 || to === -1) {
    throw new Error(`${start} … ${end} isn't in the export script`);
  }
  return text.slice(from + start.length, to);
};

interface Line {
  table?: string;
  rows?: Record<string, unknown>[];
  export?: string;
  slug?: string;
  tenantId?: string;
  end?: boolean;
  lines?: number;
}

const exportOf = async (
  client: pg.Client,
  slug: string,
): Promise<{ text: string; lines: Line[] }> => {
  const script = await readFile(SCRIPT, 'utf8');
  await client.query(`SELECT set_config('export.slug', $1, true)`, [slug]);
  const { rows } = await client.query<{ line: string }>(
    between(script, '-- export:begin', '-- export:end'),
  );
  const text = rows.map((row) => row.line).join('\n');
  return { text, lines: rows.map((row) => JSON.parse(row.line) as Line) };
};

describe("the export of one site's data (data model §3)", () => {
  it('has every table with a tenant_id, and nothing of another site', async () => {
    await inRolledBackTransaction(async (client) => {
      const { text, lines } = await exportOf(client, 'test-a');
      const [header, ...rest] = lines;
      const footer = rest.pop();
      expect(header).toMatchObject({ export: 'site', slug: 'test-a', tenantId: TENANT_A });
      expect(footer).toEqual({ end: true, lines: lines.length - 1 });

      // Every table of app with a tenant_id, as purge_tenant's own check finds them, plus the site's related rows.
      const { rows: owned } = await client.query<{ name: string }>(
        `SELECT 'app.' || c.relname AS name FROM pg_catalog.pg_attribute a
           JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
           JOIN pg_catalog.pg_namespace s ON s.oid = c.relnamespace
          WHERE s.nspname = 'app' AND c.relkind IN ('r', 'p') AND a.attname = 'tenant_id' AND NOT a.attisdropped`,
      );
      const tables = rest.map((line) => line.table);
      expect([...tables].sort((a = '', b = '') => a.localeCompare(b))).toEqual(
        [
          ...owned.map((row) => row.name),
          'app.tenants',
          'app.organizations',
          'app.brand_assets',
          'app.core_criteria',
          'auth.users',
        ].sort((a, b) => a.localeCompare(b)),
      );

      for (const line of rest) {
        const name = line.table ?? '';
        if (!owned.some((row) => row.name === name)) {
          continue;
        }
        expect(
          line.rows?.every((row) => row.tenant_id === TENANT_A),
          name,
        ).toBe(true);
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`,
          [TENANT_A],
        );
        expect(line.rows?.length, name).toBe(rows[0]?.n);
      }
      expect(text).not.toContain(TENANT_B);
      // No token's hash leaves: invitations and signups hold them, and the audit log's diffs of invitations.
      expect(text).not.toContain('token_hash');
      const { rows: hashes } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.audit_log WHERE tenant_id = $1 AND diff::text LIKE '%token_hash%'`,
        [TENANT_A],
      );
      expect(hashes[0]?.n).toBeGreaterThan(0);
      const invitations = rest.find((line) => line.table === 'app.invitations');
      expect(invitations?.rows?.length).toBeGreaterThan(0);
    });
  });

  it("gives members' names and emails only, never anything of their credentials", async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows: members } = await client.query<{ user_id: string }>(
        'SELECT DISTINCT user_id FROM app.memberships WHERE tenant_id = $1',
        [TENANT_A],
      );
      // An account for one of A's members, as Better Auth keeps it, with a session.
      const userId = members[0]?.user_id ?? '';
      await client.query(
        `INSERT INTO auth.users (id, name, email, email_verified) VALUES ($1, 'Persona de ejemplo', $2, true)
         ON CONFLICT (id) DO NOTHING`,
        [userId, `persona-${userId}@example.org`],
      );
      await client.query(
        `INSERT INTO auth.sessions (expires_at, token, updated_at, user_id, aal)
         VALUES (now() + interval '1 hour', 'token-de-ejemplo', now(), $1, 1)`,
        [userId],
      );
      const { text, lines } = await exportOf(client, 'test-a');
      const users = lines.find((line) => line.table === 'auth.users');
      expect(users?.rows).toContainEqual({
        id: userId,
        name: 'Persona de ejemplo',
        email: `persona-${userId}@example.org`,
      });
      expect(users?.rows?.every((row) => Object.keys(row).sort().join() === 'email,id,name')).toBe(
        true,
      );
      expect(text).not.toContain('token-de-ejemplo');
    });
  });

  it("leaves out the shared rows that are only another site's", async () => {
    await inRolledBackTransaction(async (client) => {
      // B's alone: an account of its country admin, a brand asset granted to it, a core criterion its criterion maps to.
      // Written with the triggers off: fixtures, not what the rules would let through.
      const coreB = '0190f8c4-0000-7000-8000-0000000009ff';
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO auth.users (id, name, email, email_verified)
         VALUES ($1, 'Persona de B', 'persona-b@example.org', true) ON CONFLICT (id) DO NOTHING`,
        [USERS.countryAdminB],
      );
      await client.query(
        'INSERT INTO app.brand_asset_grants (brand_asset_id, tenant_id, granted_by) VALUES ($1, $2, $3)',
        [BRAND_ASSETS.unused.id, TENANT_B, USERS.platformAdmin],
      );
      await client.query(
        `INSERT INTO app.core_criteria (id, key, title, description)
         VALUES ($1, 'nucleo-de-ejemplo-b', '{"es": "Criterio común de ejemplo B"}', '{"es": "Descripción"}')`,
        [coreB],
      );
      await client.query('UPDATE app.criteria SET core_criterion_id = $1 WHERE id = $2', [
        coreB,
        ELECTIONS.liveB.criterion,
      ]);
      await client.query('SET LOCAL session_replication_role = origin');

      const { text, lines } = await exportOf(client, 'test-a');
      const ids = (table: string) =>
        (lines.find((line) => line.table === table)?.rows ?? []).map((row) => row.id as string);
      const of = async (sql: string) =>
        (await client.query<{ id: string }>(sql, [TENANT_A])).rows.map((row) => row.id);
      // Each shared table holds only what A links, and all of it.
      expect(ids('app.organizations').sort()).toEqual(
        (
          await of(
            'SELECT organization_id AS id FROM app.tenant_organizations WHERE tenant_id = $1',
          )
        ).sort(),
      );
      expect(ids('app.brand_assets').sort()).toEqual(
        (
          await of(
            `SELECT brand_asset_id AS id FROM app.tenant_brand_selections
              WHERE tenant_id = $1 AND brand_asset_id IS NOT NULL
             UNION SELECT brand_asset_id FROM app.brand_asset_grants WHERE tenant_id = $1`,
          )
        ).sort(),
      );
      expect(ids('app.core_criteria').sort()).toEqual(
        (
          await of(
            'SELECT DISTINCT core_criterion_id AS id FROM app.criteria WHERE tenant_id = $1 AND core_criterion_id IS NOT NULL',
          )
        ).sort(),
      );
      const members = await of(
        'SELECT DISTINCT user_id AS id FROM app.memberships WHERE tenant_id = $1',
      );
      expect(ids('auth.users').every((id) => members.includes(id))).toBe(true);
      for (const other of [
        ORGANIZATIONS.B.id,
        ORGANIZATIONS.unlinked.id,
        BRAND_ASSETS.unused.id,
        coreB,
        USERS.countryAdminB,
        'persona-b@example.org',
      ]) {
        expect(text, other).not.toContain(other);
      }
    });
  });

  it('knows every column of a site table that looks like a credential: left out, or no secret', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `SELECT c.table_name || '.' || c.column_name AS name FROM information_schema.columns c
          WHERE c.table_schema = 'app'
            AND c.column_name ~ '(token|secret|password|passphrase|key|hash|credential)'
            AND EXISTS (SELECT 1 FROM information_schema.columns t
                         WHERE t.table_schema = 'app' AND t.table_name = c.table_name AND t.column_name = 'tenant_id')
          ORDER BY 1`,
      );
      // A column added later that looks like one fails here until the script leaves it out or it is listed as safe.
      expect(rows.map((row) => row.name)).toEqual([
        'audit_log.token_id', // which of a member's tokens wrote a row: no secret, the token is only hashed, in auth
        'invitations.token_hash', // left out (`- '{token_hash}'`, and from the audit log's diffs)
        'llm_runs.input_tokens', // a count of a model's tokens: no secret
        'llm_runs.output_tokens', // the same
        'signups.token_hash', // left out
        'signups.token_issued_at', // when a token was sent: no secret
        'signups.tokens_issued', // how many: no secret
      ]);
    });
  });

  it('refuses a short name no site has, before anything is written out', async () => {
    const script = await readFile(SCRIPT, 'utf8');
    const guard = `DO $$${between(script, 'DO $$', '$$;')}$$;`;
    await inRolledBackTransaction(async (client) => {
      await client.query(`SELECT set_config('export.slug', 'no-existe', true)`);
      await client.query('SAVEPOINT guard');
      await expect(client.query(guard)).rejects.toThrow(/no site has the short name no-existe/);
      await client.query('ROLLBACK TO SAVEPOINT guard');
      await client.query(`SELECT set_config('export.slug', 'test-a', true)`);
      await expect(client.query(guard)).resolves.toBeDefined();
    });
  });
});
