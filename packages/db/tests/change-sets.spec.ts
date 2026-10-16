import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, FILES, TENANT_A, USERS } from './rls/matrix.js';

// A change request may change several fields of one row at once (PLAN R183): an update with no single field, whose
// proposed value is an object of the fields and their values. It is proposed, reviewed and applied as one, with one
// public note, and the public record lists the fields it changed.

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

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

const live = ELECTIONS.liveA;
const party = live.secondParty;

/** Proposes, as editor A, the fields of `values` of A's live election's second party: returns the request. */
const proposeSet = async (
  client: pg.Client,
  values: Record<string, unknown>,
  { target = party, kind = 'party' }: { target?: string; kind?: string } = {},
): Promise<string> => {
  await setActor(client, USERS.editorA);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                      public_note)
     VALUES ($1, $2, 'update', $3, $4, NULL, $5, '{"es": "Nota pública de ejemplo"}') RETURNING id`,
    [TENANT_A, live.id, kind, target, JSON.stringify(values)],
  );
  return rows[0]!.id;
};

const approve = async (client: pg.Client, id: string): Promise<void> => {
  await setActor(client, USERS.countryAdminA);
  await client.query(`UPDATE app.change_requests SET state = 'approved' WHERE id = $1`, [id]);
};

const SET = {
  short_name: { es: 'PE-B2' },
  colour: '#123456',
  website: 'https://example.org/partido-b',
};

describe('a change set: proposing', () => {
  it("records each field's current value, read from the target, and each new one as its column stores it", async () => {
    await actingAs(USERS.editorA, async (client) => {
      const { rows: before } = await client.query<{
        short_name: unknown;
        colour: unknown;
        website: unknown;
      }>('SELECT short_name, colour, website FROM app.parties WHERE id = $1', [party]);
      const id = await proposeSet(client, { ...SET, colour: '#123456' });
      const { rows } = await client.query<{
        field: string | null;
        previous_value: unknown;
        proposed_value: unknown;
      }>('SELECT field, previous_value, proposed_value FROM app.change_requests WHERE id = $1', [
        id,
      ]);
      expect(rows[0]).toEqual({
        field: null,
        previous_value: before[0],
        proposed_value: SET,
      });
    });
  });

  it.each([
    ['nothing to change', {}],
    ['a field a party never changes through a request', { slug: 'partido-ejemplo-otro' }],
    ['a field the party does not have', { title: { es: 'Título' } }],
    ['a list rather than fields', [SET]],
  ])('is refused with %s', async (_name, values) => {
    expect(
      await actingAs(USERS.editorA, async (client) =>
        errorCode(
          client,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note)
           VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${party}', NULL,
                   '${JSON.stringify(values)}', '{"es": "Nota pública de ejemplo"}')`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it.each([
    ['a retirement', `'retire', 'party', '${party}', 'colour', NULL`],
    ['an addition', `'add', 'party', NULL, 'colour', '{"slug": "partido-ejemplo-nuevo"}'`],
  ])('names no single field in %s', async (_name, values) => {
    expect(
      await actingAs(USERS.editorA, async (client) =>
        errorCode(
          client,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note)
           VALUES ('${TENANT_A}', '${live.id}', ${values}, '{"es": "Nota pública de ejemplo"}')`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("removes a party's colour or logo with a null", async () => {
    await actingAs(USERS.editorA, async (client) => {
      await approve(
        client,
        await proposeSet(client, { colour: '#123456', logo_file_id: FILES.logoA.id }),
      );
      await approve(client, await proposeSet(client, { colour: null, logo_file_id: null }));
      const { rows } = await client.query(
        'SELECT logo_file_id, colour FROM app.parties WHERE id = $1',
        [party],
      );
      expect(rows[0]).toEqual({ logo_file_id: null, colour: null });
    });
  });
});

describe('a change set: approving', () => {
  it('applies every field at once, in one public record that lists them', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const id = await proposeSet(client, SET);
      await approve(client, id);
      const { rows: now } = await client.query(
        'SELECT short_name, colour, website FROM app.parties WHERE id = $1',
        [party],
      );
      expect(now[0]).toEqual(SET);
      const { rows: record } = await client.query<{ field: string | null; new_value: unknown }>(
        'SELECT field, new_value FROM app.structural_changes WHERE change_request_id = $1',
        [id],
      );
      expect(record).toEqual([{ field: null, new_value: SET }]);
      const { rows: log } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM app.corrections_log WHERE election_id = $1 AND entry_kind = 'structural_change'
           AND new_value = $2::jsonb`,
        [live.id, JSON.stringify(SET)],
      );
      expect(log[0]?.n).toBe(1);
    });
  });

  it('authorizes exactly those values: another field, or another value, in the same transaction is refused', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await approve(client, await proposeSet(client, SET));
      expect(
        await errorCode(client, `UPDATE app.parties SET display_order = 7 WHERE id = '${party}'`),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(client, `UPDATE app.parties SET colour = '#654321' WHERE id = '${party}'`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('is refused once any of its fields changed since it was proposed', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const id = await proposeSet(client, SET);
        // Another request, approved first, changes one of the set's fields.
        await approve(client, await proposeSet(client, { colour: '#abcdef' }));
        await setActor(client, USERS.countryAdminA);
        return errorCode(
          client,
          `UPDATE app.change_requests SET state = 'approved' WHERE id = '${id}'`,
        );
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('needs every text it changes in the default locale', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const id = await proposeSet(client, { ...SET, short_name: { en: 'EP-B' } });
        await setActor(client, USERS.countryAdminA);
        return errorCode(
          client,
          `UPDATE app.change_requests SET state = 'approved' WHERE id = '${id}'`,
        );
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it("takes a logo only from the site's public images", async () => {
    await actingAs(USERS.editorA, async (client) => {
      const refused = await proposeSet(client, { logo_file_id: FILES.sourceA.id });
      await setActor(client, USERS.countryAdminA);
      expect(
        await errorCode(
          client,
          `UPDATE app.change_requests SET state = 'approved' WHERE id = '${refused}'`,
        ),
      ).toBe(CHECK_VIOLATION);
      const taken = await proposeSet(client, { logo_file_id: FILES.logoA.id, colour: '#123456' });
      await approve(client, taken);
      const { rows } = await client.query(
        'SELECT logo_file_id, colour FROM app.parties WHERE id = $1',
        [party],
      );
      expect(rows[0]).toEqual({ logo_file_id: FILES.logoA.id, colour: '#123456' });
    });
  });

  it("changes a criterion's texts and the election's name and date the same way", async () => {
    await actingAs(USERS.editorA, async (client) => {
      const criterion = await proposeSet(
        client,
        { title: { es: 'Criterio de ejemplo (revisado)' }, short_title: { es: 'Revisado' } },
        { target: live.criterion, kind: 'criterion' },
      );
      await approve(client, criterion);
      const election = await proposeSet(
        client,
        { name: { es: 'Elecciones de ejemplo (revisadas)' }, election_date: '2030-05-26' },
        { target: live.id, kind: 'election' },
      );
      await approve(client, election);
      const { rows } = await client.query(
        `SELECT (SELECT title ->> 'es' FROM app.criteria WHERE id = $1) AS title,
                (SELECT election_date::text FROM app.elections WHERE id = $2) AS date`,
        [live.criterion, live.id],
      );
      expect(rows[0]).toEqual({ title: 'Criterio de ejemplo (revisado)', date: '2030-05-26' });
    });
  });
});

describe('a change set: what it records (from its review)', () => {
  it('leaves out a field already at its value, and is refused when that leaves nothing', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const { rows: now } = await client.query<{ name: unknown }>(
        'SELECT name FROM app.parties WHERE id = $1',
        [party],
      );
      const id = await proposeSet(client, { name: now[0]?.name, colour: '#0a0b0c' });
      const { rows } = await client.query<{ proposed: unknown; previous: string[] }>(
        `SELECT proposed_value AS proposed, ARRAY(SELECT jsonb_object_keys(previous_value)) AS previous
           FROM app.change_requests WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toEqual({ proposed: { colour: '#0a0b0c' }, previous: ['colour'] });
      expect(
        await errorCode(
          client,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note)
           VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${party}', NULL,
                   jsonb_build_object('name', (SELECT name FROM app.parties WHERE id = '${party}')),
                   '{"es": "Nota pública de ejemplo"}')`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('is refused for a retired row, when proposed and when approved after it was retired', async () => {
    const codes = await actingAs(USERS.editorA, async (client) => {
      const pending = await proposeSet(client, SET);
      await setActor(client, USERS.editorA);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                          proposed_value, public_note)
         VALUES ($1, $2, 'retire', 'party', $3, NULL, NULL, '{"es": "Nota pública de ejemplo"}') RETURNING id`,
        [TENANT_A, live.id, party],
      );
      await approve(client, rows[0]!.id);
      await setActor(client, USERS.countryAdminA);
      const approval = await errorCode(
        client,
        `UPDATE app.change_requests SET state = 'approved' WHERE id = '${pending}'`,
      );
      await setActor(client, USERS.editorA);
      const proposal = await errorCode(
        client,
        `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                          proposed_value, public_note)
         VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${party}', NULL, '{"colour": "#0a0b0c"}',
                 '{"es": "Nota pública de ejemplo"}')`,
      );
      return [approval, proposal];
    });
    expect(codes).toEqual([RESTRICT_VIOLATION, CHECK_VIOLATION]);
  });

  it('lets through the one write that applies it, not a later one of the same value', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        await approve(client, await proposeSet(client, { website: 'https://example.org/a' }));
        await approve(client, await proposeSet(client, { website: 'https://example.org/b' }));
        return errorCode(
          client,
          `UPDATE app.parties SET website = 'https://example.org/a' WHERE id = '${party}'`,
        );
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('is never stored empty or without a value, even past the triggers', async () => {
    const codes = await inRolledBackTransaction(async (client) => {
      // The owner's way round every trigger: the table's own checks still hold.
      await client.query('SET LOCAL session_replication_role = replica');
      const insert = (value: string) =>
        errorCode(
          client,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note, proposed_by)
           VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${party}', NULL, ${value},
                   '{"es": "Nota pública de ejemplo"}', '${USERS.editorA}')`,
        );
      return [await insert('NULL'), await insert(`'{}'`), await insert(`'[]'`)];
    });
    expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, CHECK_VIOLATION]);
  });
});

describe('a change set: every target and every approval rule', () => {
  it("needs a text in the default locale, never a null, and changes a methodology's and a reviewer's fields", async () => {
    await actingAs(USERS.editorA, async (client) => {
      const nameless = await proposeSet(client, { name: null });
      const untitled = await proposeSet(
        client,
        { short_title: null },
        {
          target: live.criterion,
          kind: 'criterion',
        },
      );
      await setActor(client, USERS.countryAdminA);
      for (const id of [nameless, untitled]) {
        expect(
          await errorCode(
            client,
            `UPDATE app.change_requests SET state = 'approved' WHERE id = '${id}'`,
          ),
        ).toBe(CHECK_VIOLATION);
      }
      await approve(
        client,
        await proposeSet(
          client,
          { body: { es: 'Metodología de ejemplo, revisada.' }, admissible_source_kinds: ['pdf'] },
          { target: live.methodology, kind: 'methodology' },
        ),
      );
      await approve(
        client,
        await proposeSet(
          client,
          { name: 'Persona Revisora de Ejemplo', affiliation: 'Universidad de ejemplo' },
          { target: live.reviewer, kind: 'methodology_reviewer' },
        ),
      );
      const { rows } = await client.query(
        `SELECT (SELECT body ->> 'es' FROM app.methodologies WHERE id = $1) AS body,
                (SELECT admissible_source_kinds::text[] FROM app.methodologies WHERE id = $1) AS kinds,
                (SELECT affiliation FROM app.methodology_reviewers WHERE id = $2) AS affiliation`,
        [live.methodology, live.reviewer],
      );
      expect(rows[0]).toEqual({
        body: 'Metodología de ejemplo, revisada.',
        kinds: ['pdf'],
        affiliation: 'Universidad de ejemplo',
      });
    });
  });

  it('is refused to a reviewer, to its proposer where a second approver is needed, and in the freeze window', async () => {
    const codes = await actingAs(USERS.editorA, async (client) => {
      const id = await proposeSet(client, SET);
      await setActor(client, USERS.reviewerA);
      const reviewer = await errorCode(
        client,
        `UPDATE app.change_requests SET state = 'approved' WHERE id = '${id}'`,
      );
      await setActor(client, USERS.platformAdmin);
      await client.query(
        'UPDATE app.tenants SET live_edits_need_second_approver = true WHERE id = $1',
        [TENANT_A],
      );
      await setActor(client, USERS.countryAdminA);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                          proposed_value, public_note)
         VALUES ($1, $2, 'update', 'party', $3, NULL, '{"colour": "#0a0b0c"}', '{"es": "Nota pública de ejemplo"}')
         RETURNING id`,
        [TENANT_A, live.id, party],
      );
      const own = await errorCode(
        client,
        `UPDATE app.change_requests SET state = 'approved' WHERE id = '${rows[0]!.id}'`,
      );
      await client.query('UPDATE app.elections SET frozen_from = now() WHERE id = $1', [live.id]);
      const frozen = await errorCode(
        client,
        `UPDATE app.change_requests SET state = 'approved' WHERE id = '${id}'`,
      );
      return [reviewer, own, frozen];
    });
    expect(codes).toEqual([INSUFFICIENT_PRIVILEGE, INSUFFICIENT_PRIVILEGE, RESTRICT_VIOLATION]);
  });
});
