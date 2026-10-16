import { createDatabase } from '@aiontheballot/db/client';
import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import { logsInAs } from '../src/database-roles.js';
import { inRolledBackTransaction } from './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  applicationName: 'aiontheballot-api-tests',
});

afterAll(async () => {
  await admin.destroy();
});

describe("a connection's role, checked at startup (PLAN R181)", () => {
  it('is the login its routes assume, and no other', async () => {
    expect(await logsInAs(admin, 'aiontheballot_admin')).toBe(true);
    expect(await logsInAs(admin, 'aiontheballot_web')).toBe(false);
  });

  it('is never another login acting as that role', async () => {
    await inRolledBackTransaction(async (trx) => {
      await sql`SET LOCAL ROLE aiontheballot_preview`.execute(trx);
      expect(await logsInAs(trx, 'aiontheballot_preview')).toBe(false);
    });
  });
});
