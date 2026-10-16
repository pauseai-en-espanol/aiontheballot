import { describe, expect, it, vi } from 'vitest';

import { createPool } from './pool.js';

describe('a pool that outlives a lost connection (R153)', () => {
  it("takes an idle connection's error instead of letting it end the process, logging only its SQLSTATE", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Never connects: nothing is asked of it.
    const pool = createPool({ connectionString: 'postgres://nadie@127.0.0.1:1/ninguna' });
    const lost = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    });
    expect(() => pool.emit('error', lost)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      'A database connection was lost (57P01); the pool opens another when needed',
    );
    expect(String(warn.mock.calls)).not.toContain('administrator command');
    await pool.end();
  });
});
