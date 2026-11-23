import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, TENANT_A, TENANT_B, USERS } from './rls/matrix.js';

// An entry taken out of the public corrections log (PLAN R248): a site's country admin or a platform admin removes the
// entry of a structural change made by mistake, once later changes have replaced everything it changed. The change stays as it was recorded; the removal is audited and can be undone.

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const live = ELECTIONS.liveA;
const NOTE = `'{"es": "Nota pública de ejemplo"}'`;

const setActor = async (client: pg.Client, userId: string): Promise<void> => {
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
    [userId],
  );
};

/** As `userId` through the admin role, in a transaction that is rolled back. */
const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await setActor(client, userId);
    return fn(client);
  });

/** A change of the election's second party, proposed and approved by country admin A: its public record's id. */
const changed = async (
  client: pg.Client,
  field: string | null,
  value: string,
  { target = live.secondParty, kind = 'party', action = 'update' } = {},
): Promise<string> => {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                      public_note)
     VALUES ('${TENANT_A}', '${live.id}', '${action}', '${kind}', '${target}', $1, $2, ${NOTE}) RETURNING id`,
    [field, action === 'retire' ? null : value],
  );
  const request = rows[0]!.id;
  await client.query(`UPDATE app.change_requests SET state = 'approved' WHERE id = $1`, [request]);
  return (
    await client.query<{ id: string }>(
      'SELECT id FROM app.structural_changes WHERE change_request_id = $1',
      [request],
    )
  ).rows[0]!.id;
};

const short = (text: string): string => JSON.stringify({ es: text });

const remove = (change: string, tenant = TENANT_A): string =>
  `INSERT INTO app.log_removals (tenant_id, structural_change_id) VALUES ('${tenant}', '${change}')`;
const restore = (change: string): string =>
  `DELETE FROM app.log_removals WHERE structural_change_id = '${change}'`;

/** The ids of the structural changes the corrections log shows `role`, of those given. */
const inLog = async (client: pg.Client, changes: readonly string[]): Promise<string[]> =>
  (
    await client.query<{ entry_id: string }>(
      `SELECT entry_id FROM app.corrections_log
        WHERE entry_kind = 'structural_change' AND entry_id = ANY ($1) ORDER BY entry_id`,
      [changes],
    )
  ).rows.map((row) => row.entry_id);

/** The same, and the records themselves, as the public site's role (or the preview's). */
const asPublic = async (
  client: pg.Client,
  changes: readonly string[],
  role = 'aiontheballot_web',
): Promise<{ log: string[]; records: string[] }> => {
  await client.query(`SET LOCAL ROLE ${role}`);
  await client.query(`SELECT set_config('app.user_id', '', true), set_config('app.aal', '', true)`);
  const log = await inLog(client, changes);
  const records = (
    await client.query<{ id: string }>(
      'SELECT id FROM app.structural_changes WHERE id = ANY ($1) ORDER BY id',
      [changes],
    )
  ).rows.map((row) => row.id);
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  return { log, records };
};

/** A slip and the change that put it right, both of the party's short name. */
const slip = async (client: pg.Client): Promise<{ wrong: string; right: string }> => ({
  wrong: await changed(client, 'short_name', short('Texto pegado por error')),
  right: await changed(client, 'short_name', short('PE-B')),
});

describe('an entry taken out of the public corrections log (PLAN R248)', () => {
  it.each([
    ["the site's country admin", USERS.countryAdminA],
    ['a platform admin', USERS.platformAdmin],
  ])('is removed by %s, and then the public reads neither it nor its values', async (_, who) => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      expect(await asPublic(client, [wrong, right])).toEqual({
        log: [wrong, right],
        records: [wrong, right],
      });
      await setActor(client, who);
      expect(await errorCode(client, remove(wrong))).toBeNull();
      expect(await asPublic(client, [wrong, right])).toEqual({ log: [right], records: [right] });
      expect(await asPublic(client, [wrong, right], 'aiontheballot_preview')).toEqual({
        log: [right],
        records: [right],
      });
    });
  });

  it('keeps the change as it was recorded, which members still read', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      await client.query(remove(wrong));
      await setActor(client, USERS.editorA);
      expect(
        (
          await client.query<{ new_value: unknown }>(
            'SELECT new_value FROM app.structural_changes WHERE id = $1',
            [wrong],
          )
        ).rows,
      ).toEqual([{ new_value: { es: 'Texto pegado por error' } }]);
      // The log itself reads the same for everyone.
      expect(await inLog(client, [wrong, right])).toEqual([right]);
    });
  });

  it('is put back by undoing the removal', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      await client.query(remove(wrong));
      await setActor(client, USERS.countryAdminA);
      const undone = await client.query(restore(wrong));
      expect(undone.rowCount).toBe(1);
      expect((await asPublic(client, [wrong, right])).log).toEqual([wrong, right]);
    });
  });

  it('is recorded in the audit log, removed and put back, by whom', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(remove(wrong));
      await client.query(restore(wrong));
      await client.query('RESET ROLE');
      expect(
        (
          await client.query<{ action: string; actor_id: string }>(
            `SELECT action, actor_id FROM app.audit_log
              WHERE table_name = 'log_removals' AND tenant_id = $1 ORDER BY id`,
            [TENANT_A],
          )
        ).rows.slice(-2),
      ).toEqual([
        { action: 'insert', actor_id: USERS.countryAdminA },
        { action: 'delete', actor_id: USERS.countryAdminA },
      ]);
    });
  });

  it('moves the public version, so the public site follows', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      const version = async () =>
        Number(
          (
            await client.query<{ version: string }>(
              'SELECT version FROM app.public_versions WHERE tenant_id = $1',
              [TENANT_A],
            )
          ).rows[0]!.version,
        );
      await client.query('RESET ROLE');
      const before = await version();
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(remove(wrong));
      await client.query('RESET ROLE');
      expect(await version()).toBe(before + 1);
    });
  });

  it.each([
    ['an editor', USERS.editorA],
    ['a reviewer', USERS.reviewerA],
    ["another site's country admin", USERS.countryAdminB],
    ['nobody', USERS.noMembership],
  ])('is not removed by %s', async (_, who) => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await setActor(client, who);
      expect(await errorCode(client, remove(wrong))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it.each([
    ['an editor', USERS.editorA],
    ['a reviewer', USERS.reviewerA],
  ])('is not put back by %s', async (_, who) => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(remove(wrong));
      await setActor(client, who);
      expect((await client.query(restore(wrong))).rowCount).toBe(0);
    });
  });

  it('is not removed without a second factor', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(`SELECT set_config('app.aal', '1', true)`);
      expect(await errorCode(client, remove(wrong))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("is neither removed nor put back through a member's token", async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      const again = await changed(client, 'short_name', short('PE-B2'));
      await client.query(remove(wrong));
      await client.query(`SELECT set_config('app.token_id', $1, true)`, [again]);
      expect(await errorCode(client, remove(right))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await errorCode(client, restore(wrong))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('is removed once', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(remove(wrong));
      expect(await errorCode(client, remove(wrong))).toBe(UNIQUE_VIOLATION);
    });
  });

  it("is of the site that removes it: not another's change, nor one that doesn't exist", async () => {
    await actingAs(USERS.platformAdmin, async (client) => {
      await setActor(client, USERS.countryAdminA);
      const { wrong } = await slip(client);
      await setActor(client, USERS.platformAdmin);
      expect(await errorCode(client, remove(wrong, TENANT_B))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await errorCode(client, remove(USERS.newcomer))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it('takes its election from the change, never from the caller', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(remove(wrong));
      expect(
        (
          await client.query<{ election_id: string }>(
            'SELECT election_id FROM app.log_removals WHERE structural_change_id = $1',
            [wrong],
          )
        ).rows,
      ).toEqual([{ election_id: live.id }]);
      expect(
        await errorCode(
          client,
          `INSERT INTO app.log_removals (tenant_id, election_id, structural_change_id)
           VALUES ('${TENANT_A}', '${live.id}', '${wrong}')`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('which entries may be taken out of the log (PLAN R248)', () => {
  it('not the change in force: nothing has replaced it', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      expect(await errorCode(client, remove(right))).toBe(CHECK_VIOLATION);
      await client.query(remove(wrong));
      expect(await errorCode(client, remove(right))).toBe(CHECK_VIOLATION);
    });
  });

  it("not one that a change of another field, or of another target's, followed", async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const wrong = await changed(client, 'short_name', short('Texto pegado por error'));
      await changed(client, 'website', JSON.stringify('https://partido-ejemplo.test/otra'));
      await changed(client, 'short_name', short('PE-A'), { target: live.party });
      expect(await errorCode(client, remove(wrong))).toBe(CHECK_VIOLATION);
    });
  });

  it('a set of fields, once each of them was changed again, together or one by one', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const wrong = await changed(
        client,
        null,
        JSON.stringify({
          short_name: { es: 'Texto pegado por error' },
          website: 'https://partido-ejemplo.test/error',
        }),
      );
      await changed(client, 'short_name', short('PE-B'));
      expect(await errorCode(client, remove(wrong))).toBe(CHECK_VIOLATION);
      await changed(client, 'website', JSON.stringify('https://partido-ejemplo.test/bien'));
      expect(await errorCode(client, remove(wrong))).toBeNull();
    });
  });

  it('one field, replaced by a set that holds it', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const wrong = await changed(client, 'short_name', short('Texto pegado por error'));
      await changed(
        client,
        null,
        JSON.stringify({ short_name: { es: 'PE-B' }, website: 'https://partido-ejemplo.test/' }),
      );
      expect(await errorCode(client, remove(wrong))).toBeNull();
    });
  });

  it('several slips in a row, but never the last change, so the log always holds the change in force', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const first = await changed(client, 'short_name', short('Primer error'));
      const second = await changed(client, 'short_name', short('Segundo error'));
      const third = await changed(client, 'short_name', short('PE-B'));
      expect(await errorCode(client, remove(second))).toBeNull();
      expect(await errorCode(client, remove(first))).toBeNull();
      expect(await errorCode(client, remove(third))).toBe(CHECK_VIOLATION);
      expect((await asPublic(client, [first, second, third])).log).toEqual([third]);
    });
  });

  it('an update only: what was added or retired stays in the log', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const retired = await changed(client, null, '', { action: 'retire' });
      expect(await errorCode(client, remove(retired))).toBe(CHECK_VIOLATION);
    });
  });

  it('nothing inside a freeze window, neither removed nor put back', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong, right } = await slip(client);
      await changed(client, 'short_name', short('PE-B3'));
      await client.query(remove(wrong));
      await client.query(
        `UPDATE app.elections SET frozen_from = now() - interval '1 hour', frozen_until = now() + interval '1 hour'
          WHERE id = $1`,
        [live.id],
      );
      expect(await errorCode(client, remove(right))).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, restore(wrong))).toBe(RESTRICT_VIOLATION);
    });
  });

  it('a removal never changes: it is made, or undone', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const { wrong } = await slip(client);
      await client.query(remove(wrong));
      expect(await errorCode(client, 'UPDATE app.log_removals SET created_at = now()')).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});
