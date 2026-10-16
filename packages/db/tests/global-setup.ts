import { resolveBinary } from 'dbmate';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

import { migrationsDir, ownerUrl, superuserUrl } from './env.js';
import { loadFixtures } from './rls/fixtures.js';

const run = promisify(execFile);

/**
 * Rebuilds aiontheballot_test from scratch: drop everything the owner created, apply every migration as the owner,
 * then load the matrix fixtures.
 */
export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl() });
  await client.connect();
  try {
    await client.query(`
      DO $$
      DECLARE s record;
      BEGIN
        FOR s IN SELECT nspname FROM pg_namespace WHERE nspowner = current_user::regrole AND nspname <> 'public' LOOP
          EXECUTE format('DROP SCHEMA %I CASCADE', s.nspname);
        END LOOP;
      END $$;
      DROP TABLE IF EXISTS public.schema_migrations;
    `);
  } finally {
    await client.end();
  }
  await run(resolveBinary(), [
    '--url',
    ownerUrl(),
    '--migrations-dir',
    migrationsDir,
    '--no-dump-schema',
    'up',
  ]);

  const superuser = new pg.Client({ connectionString: superuserUrl() });
  await superuser.connect();
  try {
    await loadFixtures(superuser);
  } finally {
    await superuser.end();
  }
}
