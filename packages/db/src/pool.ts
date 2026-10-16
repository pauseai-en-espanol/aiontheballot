import pg from 'pg';

/**
 * A pool that outlives a lost connection (PLAN R153). When an idle connection dies (Postgres restarted, a restore
 * ended every session, the network dropped it), pg emits `error` on the pool; with no listener, Node throws it and
 * the process exits. The pool has already let that connection go and opens another when next asked, so a warning is
 * all it takes. Only the SQLSTATE is logged, never the message.
 */
export const createPool = (config: pg.PoolConfig): pg.Pool => {
  const pool = new pg.Pool(config);
  pool.on('error', (error: Error & { code?: unknown }) => {
    const code = typeof error.code === 'string' ? error.code : 'no SQLSTATE';
    console.warn(`A database connection was lost (${code}); the pool opens another when needed`);
  });
  return pool;
};
