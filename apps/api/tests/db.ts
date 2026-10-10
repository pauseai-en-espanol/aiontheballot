import type { DB } from '@aiontheballot/db/generated/db';
import type { Transaction } from 'kysely';

import { createDatabase } from '@aiontheballot/db/client';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const ROLLBACK = Symbol('rollback');

/**
 * Runs `fn` in a superuser transaction of aiontheballot_test that is always rolled back. It switches to a runtime role
 * itself (`SET LOCAL ROLE`), as the database package's tests do; a transaction, like withActor's, is what the data
 * functions take.
 */
export const inRolledBackTransaction = async <T>(
  fn: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> => {
  const url = process.env.TEST_SUPERUSER_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_SUPERUSER_DATABASE_URL is not set. Copy .env.example to .env.');
  }
  const pool = createDatabase({ connectionString: url, maxConnections: 1 });
  let result: T | undefined;
  try {
    await pool.transaction().execute(async (trx) => {
      result = await fn(trx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) {
      throw error;
    }
  } finally {
    await pool.destroy();
  }
  return result as T;
};
