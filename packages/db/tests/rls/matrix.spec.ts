import { describe, expect, it } from 'vitest';

import { inRolledBackTransaction } from '../db.js';
import { PRINCIPALS, RELATIONS } from './matrix.js';

describe('isolation matrix', () => {
  it('covers every table and view in app, and nothing else', async () => {
    const relations = await inRolledBackTransaction(async (client) =>
      (
        await client.query<{ name: string }>(
          `SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p', 'v') ORDER BY 1`,
        )
      ).rows.map((r) => r.name),
    );
    expect(Object.keys(RELATIONS).sort()).toEqual(relations);
  });

  it('names every principal uniquely', () => {
    const ids = PRINCIPALS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
