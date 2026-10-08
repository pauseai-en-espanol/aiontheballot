import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';

import type { DB } from './generated/db.js';

export type Database = Kysely<DB>;

export interface DatabaseOptions {
  /** Connection string for one runtime role: ballot_web, ballot_admin or ballot_worker. Never the owner. */
  connectionString: string;
  maxConnections?: number;
  applicationName?: string;
}

export const createDatabase = ({
  connectionString,
  maxConnections = 10,
  applicationName,
}: DatabaseOptions): Database =>
  new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString,
        max: maxConnections,
        application_name: applicationName,
      }),
    }),
  });
