import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction, RUNTIME_ROLES } from './db.js';

const RESTRICT_VIOLATION = '23001';

const REVISION_TABLES = [
  'assessment_revisions',
  'revision_evidence',
  'revision_checked_documents',
  'revision_internal',
];

describe('published revisions', () => {
  it('take only the cell and the version reviewed from a publisher, never content', async () => {
    const insertable = await inRolledBackTransaction(async (client) =>
      (
        await client.query<{ grant: string }>(
          `SELECT r.role || ' ' || c.relname || '.' || a.attname AS grant
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             CROSS JOIN unnest($1::text[]) AS r(role)
            WHERE c.oid = ANY ($2::regclass[]) AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege(r.role, a.attrelid, a.attnum, 'INSERT')
            ORDER BY 1`,
          [RUNTIME_ROLES, REVISION_TABLES.map((t) => `app.${t}`)],
        )
      ).rows.map((r) => r.grant),
    );
    expect(insertable).toEqual([
      'aiontheballot_admin assessment_revisions.assessment_id',
      'aiontheballot_admin assessment_revisions.reviewed_version',
    ]);
  });

  it.each(REVISION_TABLES)('are never truncated, not even by the owner: %s', async (table) => {
    expect(
      await inRolledBackTransaction(async (client) => {
        await client.query('SET LOCAL ROLE aiontheballot_owner');
        return errorCode(client, `TRUNCATE app.${table} CASCADE`);
      }),
    ).toBe(RESTRICT_VIOLATION);
  });
});

describe('sources cited by public revisions', () => {
  it('show the public only their public columns: never the stored copy, its extraction or who added it', async () => {
    const readable = await inRolledBackTransaction(async (client) =>
      (
        await client.query<{ column: string }>(
          `SELECT a.attname AS column FROM pg_attribute a
            WHERE a.attrelid = 'app.source_documents'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('aiontheballot_web', a.attrelid, a.attnum, 'SELECT')
            ORDER BY 1`,
        )
      ).rows.map((r) => r.column),
    );
    expect(readable).toEqual(
      [
        'archive_url',
        'election_id',
        'id',
        'is_programme',
        'kind',
        'language',
        'party_id',
        'retrieved_at',
        'sha256',
        'title',
        'url',
      ].sort(),
    );
  });
});
