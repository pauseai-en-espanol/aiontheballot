import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { withActor } from '../src/actor.js';
import { createDatabase } from '../src/client.js';
import { superuserUrl } from './env.js';

const USER = '0190f8c4-0000-7000-8000-000000000001';

describe('withActor', () => {
  // One connection, so the "after the transaction" check runs on the connection the actor used.
  const db = createDatabase({ connectionString: superuserUrl(), maxConnections: 1 });

  afterAll(async () => {
    await db.destroy();
  });

  it('exposes the actor to aiontheballot_admin through the private helpers', async () => {
    const seen = await withActor(db, { userId: USER, aal: 2 }, async (trx) => {
      await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
      const result = await sql<{ user_id: string; aal: number }>`
        SELECT private.current_user_id() AS user_id, private.current_aal() AS aal`.execute(trx);
      return result.rows[0];
    });
    expect(seen).toEqual({ user_id: USER, aal: 2 });
  });

  it('does not leak the actor past the transaction', async () => {
    await withActor(db, { userId: USER, aal: 1 }, async () => undefined);
    const result = await sql<{ user_id: string | null }>`
      SELECT nullif(current_setting('app.user_id', true), '') AS user_id`.execute(db);
    expect(result.rows[0]?.user_id).toBeNull();
  });

  it('means "no actor" when nothing is set', async () => {
    const result = await sql<{ user_id: string | null; aal: number }>`
      SELECT private.current_user_id() AS user_id, private.current_aal() AS aal`.execute(db);
    expect(result.rows[0]).toEqual({ user_id: null, aal: 0 });
  });

  it('rejects a malformed actor before touching the database', async () => {
    await expect(withActor(db, { userId: 'admin', aal: 2 }, async () => undefined)).rejects.toThrow(
      /UUID/,
    );
    await expect(
      withActor(db, { userId: USER, aal: 3 as 2 }, async () => undefined),
    ).rejects.toThrow(/aal/);
  });
});
