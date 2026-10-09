import pg from 'pg';

import { superuserUrl } from './env.js';

/** Runs `fn` in a superuser transaction that is always rolled back, so tests never leave anything behind. */
export const inRolledBackTransaction = async <T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> => {
  const client = new pg.Client({ connectionString: superuserUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
};

/** Runs `sql` inside a savepoint and returns the SQLSTATE it failed with, or null if it succeeded. */
export const errorCode = async (client: pg.Client, sql: string): Promise<string | null> => {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql);
    await client.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    return (error as { code?: string }).code ?? 'unknown';
  }
};

export const RUNTIME_ROLES = [
  'aiontheballot_web',
  'aiontheballot_admin',
  'aiontheballot_worker',
] as const;
