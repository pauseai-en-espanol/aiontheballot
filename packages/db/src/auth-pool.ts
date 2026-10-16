import pg from 'pg';

import { createPool } from './pool.js';

/**
 * The connections Better Auth runs on (ADR-0002 §2): as `aiontheballot_auth`, which reaches only the `auth` schema,
 * with that schema first on the search path so Better Auth's unqualified table names find its tables. Kept apart from
 * the admin role's pool, which `withActor` uses for everything a signed-in user does.
 */
export interface AuthPoolOptions {
  /** Connection string for aiontheballot_auth. Never another role. */
  connectionString: string;
  maxConnections?: number;
  applicationName?: string;
}

/**
 * `bigint` as a number, not pg's default string: Better Auth's rate limiter keeps epoch milliseconds in one
 * (`rate_limits.last_request`) and computes with them, and they fit a number exactly.
 */
const authTypes: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    oid === pg.types.builtins.INT8 && format !== 'binary'
      ? (value: string) => Number(value)
      : pg.types.getTypeParser(oid, format)) as pg.CustomTypesConfig['getTypeParser'],
};

export const createAuthPool = ({
  connectionString,
  maxConnections = 5,
  applicationName,
}: AuthPoolOptions): pg.Pool =>
  createPool({
    connectionString,
    max: maxConnections,
    application_name: applicationName,
    options: '-c search_path=auth',
    types: authTypes,
  });
