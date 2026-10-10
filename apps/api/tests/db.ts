import { createDatabase, type Database } from '@aiontheballot/db/client';
import { sql } from 'kysely';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * Runs `fn` on one superuser connection of aiontheballot_test, inside a transaction that is always rolled back. It
 * switches to a runtime role itself (`SET LOCAL ROLE`), as the database package's tests do.
 */
export const inRolledBackTransaction = async <T>(fn: (db: Database) => Promise<T>): Promise<T> => {
  const url = process.env.TEST_SUPERUSER_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_SUPERUSER_DATABASE_URL is not set. Copy .env.example to .env.');
  }
  const pool = createDatabase({ connectionString: url, maxConnections: 1 });
  try {
    return await pool.connection().execute(async (db) => {
      await sql`BEGIN`.execute(db);
      try {
        return await fn(db);
      } finally {
        await sql`ROLLBACK`.execute(db);
      }
    });
  } finally {
    await pool.destroy();
  }
};
