import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';

import { listParties, setProgrammeStatus } from '../src/admin/structure.js';
import { inRolledBackTransaction } from './db.js';
import { ELECTIONS_A, USERS } from './fixtures.js';

const as = async (trx: Transaction<DB>, user: string) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${user}, true), set_config('app.aal', '2', true)`.execute(
    trx,
  );
};

const { live } = ELECTIONS_A;
/** The live election's first party has a source marked as its programme; its second, none. */
const [withProgramme, withoutProgramme] = live.parties;

describe("a party's programme status (editorial workflow PS1)", () => {
  it('records a check as an editor, even to the same status, with the date the public sees', async () => {
    await inRolledBackTransaction(async (trx) => {
      await as(trx, USERS.editorA);
      const before = await listParties(trx, live.id);
      expect(
        before.map((p) => [p.programmeStatus, p.programmeCheckedAt, p.hasProgrammeSource]),
      ).toEqual([
        ['pending', null, true],
        ['pending', null, false],
      ]);
      expect(await setProgrammeStatus(trx, live.id, withProgramme!, 'pending')).toBe('changed');
      expect(await setProgrammeStatus(trx, live.id, withProgramme!, 'published')).toBe('changed');
      const [first] = await listParties(trx, live.id);
      expect(first?.programmeStatus).toBe('published');
      expect(Date.parse(first?.programmeCheckedAt ?? '')).not.toBeNaN();
    });
  });

  it("refuses 'published' without a source marked as the party's programme", async () => {
    await inRolledBackTransaction(async (trx) => {
      await as(trx, USERS.editorA);
      await expect(
        setProgrammeStatus(trx, live.id, withoutProgramme!, 'published'),
      ).rejects.toMatchObject({
        code: '23514',
      });
    });
  });

  it('changes nothing for a reviewer, who writes no structure', async () => {
    await inRolledBackTransaction(async (trx) => {
      await as(trx, USERS.reviewerA);
      expect(await setProgrammeStatus(trx, live.id, withProgramme!, 'pending')).not.toBe('changed');
    });
  });
});
