import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { superuserUrl } from './env.js';
import { CELLS, ELECTIONS, TENANT_A, USERS } from './rls/matrix.js';

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
const NOTE = `'{"es": "Nota pública de ejemplo"}'`;

interface Proposal {
  action?: string;
  kind?: string;
  target?: string | null;
  field?: string | null;
  value?: string;
  note?: string;
  election?: string;
}

const proposeSql = ({
  action = 'update',
  kind = 'party',
  target = live.secondParty,
  field = 'short_name',
  value = `'{"es": "PE-B"}'`,
  note = NOTE,
  election = live.id,
}: Proposal = {}): string =>
  `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field, proposed_value,
                                    public_note)
   VALUES ('${TENANT_A}', '${election}', '${action}', '${kind}', ${target ? `'${target}'` : 'NULL'},
           ${field ? `'${field}'` : 'NULL'}, ${value}, ${note})
   RETURNING id`;

const propose = async (client: pg.Client, proposal: Proposal = {}): Promise<string> =>
  (await client.query<{ id: string }>(proposeSql(proposal))).rows[0]!.id;

const decide = (id: string, state = 'approved'): string =>
  `UPDATE app.change_requests SET state = '${state}' WHERE id = '${id}'`;

/** Proposes as editor A, then decides as `approver`. */
const proposedThenApproved = async (
  client: pg.Client,
  proposal: Proposal = {},
  approver = USERS.countryAdminA,
) => {
  await setActor(client, USERS.editorA);
  const id = await propose(client, proposal);
  await setActor(client, approver);
  await client.query(decide(id));
  return id;
};

describe('a live election', () => {
  it.each([
    [
      "the election's name",
      `UPDATE app.elections SET name = '{"es": "Otro nombre"}' WHERE id = '${live.id}'`,
    ],
    [
      "the election's intro",
      `UPDATE app.elections SET intro = '{"es": "Otra introducción"}' WHERE id = '${live.id}'`,
    ],
    [
      'the methodology',
      `UPDATE app.methodologies SET body = '{"es": "Otra metodología"}' WHERE id = '${live.methodology}'`,
    ],
    [
      'an external reviewer',
      `UPDATE app.methodology_reviewers SET affiliation = 'Otra' WHERE id = '${live.reviewer}'`,
    ],
    ["a party's colour", `UPDATE app.parties SET colour = '#123456' WHERE id = '${live.party}'`],
    [
      "a criterion's title",
      `UPDATE app.criteria SET title = '{"es": "Otro título"}' WHERE id = '${live.criterion}'`,
    ],
    [
      'retiring a criterion',
      `UPDATE app.criteria SET retired_at = now() WHERE id = '${live.criterion}'`,
    ],
    [
      'adding a party',
      `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
       VALUES ('${TENANT_A}', '${live.id}', 'partido-nuevo', '{"es": "Partido Nuevo"}', '{"es": "PN"}', 9)`,
    ],
  ])('refuses a direct change to %s, whatever the session says', async (_name, sql) => {
    const codes = await actingAs(USERS.countryAdminA, async (client) => [
      await errorCode(client, sql),
      await (async () => {
        await client.query(
          `SELECT set_config('app.purge', 'on', true), set_config('app.change_request', 'approved', true)`,
        );
        return errorCode(client, sql);
      })(),
    ]);
    expect(codes).toEqual([RESTRICT_VIOLATION, RESTRICT_VIOLATION]);
  });

  it("still takes a party's programme status directly", async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          `UPDATE app.parties SET programme_status = 'pending' WHERE id = '${live.party}'`,
        ),
      ),
    ).toBeNull();
  });
});

describe('proposing a change', () => {
  it('records the proposer, the time and the current value, read from the target', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const id = await propose(client);
      const { rows } = await client.query(
        `SELECT proposed_by, proposed_at = now() AS now, previous_value, proposed_value, state FROM app.change_requests
          WHERE id = $1`,
        [id],
      );
      expect(rows).toEqual([
        {
          proposed_by: USERS.editorA,
          now: true,
          previous_value: { es: 'PEB' },
          proposed_value: { es: 'PE-B' },
          state: 'pending',
        },
      ]);
    });
  });

  it('never takes the previous value from the caller', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, previous_value, public_note)
           VALUES ('${TENANT_A}', '${live.id}', 'update', 'party', '${live.secondParty}', 'short_name',
                   '{"es": "PE-B"}', '{"es": "Otro"}', ${NOTE})`,
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is for live elections only', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          proposeSql({ election: ELECTIONS.draftA.id, target: ELECTIONS.draftA.secondParty }),
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it.each<[string, Proposal]>([
    ['a target in another election', { target: ELECTIONS.archivedA.secondParty }],
    ["another tenant's target", { target: ELECTIONS.liveB.secondParty }],
    [
      'a column that is not change-controlled',
      { field: 'programme_status', value: `'"published"'` },
    ],
    ['a slug, fixed once live', { field: 'slug', value: `'"otro-partido"'` }],
    [
      'an added election',
      { action: 'add', kind: 'election', target: null, field: null, value: `'{}'` },
    ],
    [
      'an addition with a column that is not for callers',
      {
        action: 'add',
        target: null,
        field: null,
        value: `'{"slug": "nuevo", "retired_at": "2020-01-01"}'`,
      },
    ],
    ['a retirement with a value', { action: 'retire', field: null, value: `'{}'` }],
    [
      'a retired methodology',
      {
        action: 'retire',
        kind: 'methodology',
        target: live.methodology,
        field: null,
        value: 'NULL',
      },
    ],
  ])('is refused for %s', async (_name, proposal) => {
    expect(await actingAs(USERS.editorA, (c) => errorCode(c, proposeSql(proposal)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it('is refused for retiring what is already retired', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const retire = {
          action: 'retire',
          kind: 'criterion',
          target: live.criterion,
          field: null,
          value: 'NULL',
        };
        await client.query(decide(await propose(client, retire)));
        return errorCode(client, proposeSql(retire));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('is not open to reviewers', async () => {
    expect(await actingAs(USERS.reviewerA, (c) => errorCode(c, proposeSql()))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });
});

describe('approving a change', () => {
  it('applies it as the approver, in the same transaction, and records it publicly', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const id = await proposedThenApproved(client);
      expect(
        (
          await client.query(
            `SELECT decided_by, decided_at = now() AS now, decided_txid = pg_current_xact_id() AS same_transaction
               FROM app.change_requests WHERE id = $1`,
            [id],
          )
        ).rows,
      ).toEqual([{ decided_by: USERS.countryAdminA, now: true, same_transaction: true }]);
      expect(
        (await client.query('SELECT short_name FROM app.parties WHERE id = $1', [live.secondParty]))
          .rows,
      ).toEqual([{ short_name: { es: 'PE-B' } }]);
      expect(
        (
          await client.query(
            `SELECT action, target_kind, target_id, field, previous_value, new_value, approved_at = now() AS now
               FROM app.structural_changes WHERE change_request_id = $1`,
            [id],
          )
        ).rows,
      ).toEqual([
        {
          action: 'update',
          target_kind: 'party',
          target_id: live.secondParty,
          field: 'short_name',
          previous_value: { es: 'PEB' },
          new_value: { es: 'PE-B' },
          now: true,
        },
      ]);
    });
  });

  it('applies a value written differently from how the column stores it', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await proposedThenApproved(client, {
        kind: 'election',
        target: live.id,
        field: 'election_date',
        value: `'"2030-1-2"'`,
      });
      expect(
        (
          await client.query(
            `SELECT election_date::text AS date FROM app.elections WHERE id = $1`,
            [live.id],
          )
        ).rows,
      ).toEqual([{ date: '2030-01-02' }]);
    });
  });

  it('authorizes exactly the approved value, nothing else in the same transaction', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        await proposedThenApproved(client);
        return errorCode(
          client,
          `UPDATE app.parties SET short_name = '{"es": "Otro"}' WHERE id = '${live.secondParty}'`,
        );
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('authorizes nothing in a later transaction', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        // The fixtures approved this description in their own transaction; set it aside, then write it again.
        await client.query('RESET ROLE');
        await client.query('SET LOCAL session_replication_role = replica');
        await client.query(`UPDATE app.criteria SET description = '{"es": "Otra"}' WHERE id = $1`, [
          live.criterion,
        ]);
        await client.query('SET LOCAL session_replication_role = origin');
        await client.query('SET LOCAL ROLE aiontheballot_admin');
        return errorCode(
          client,
          `UPDATE app.criteria SET description = '{"es": "Descripción de ejemplo revisada"}' WHERE id = '${live.criterion}'`,
        );
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('adds a party, recording the new row', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const id = await proposedThenApproved(client, {
        action: 'add',
        target: null,
        field: null,
        value: `'{"slug": "partido-ejemplo-c", "name": {"es": "Partido Ejemplo C"}, "short_name": {"es": "PEC"},
                  "display_order": 3}'`,
      });
      const { rows } = await client.query<{ target_id: string }>(
        'SELECT target_id FROM app.structural_changes WHERE change_request_id = $1',
        [id],
      );
      expect(
        (
          await client.query('SELECT election_id, slug FROM app.parties WHERE id = $1', [
            rows[0]!.target_id,
          ])
        ).rows,
      ).toEqual([{ election_id: live.id, slug: 'partido-ejemplo-c' }]);
    });
  });

  it("changes a criterion's short title through a change request", async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await proposedThenApproved(client, {
        kind: 'criterion',
        target: live.criterion,
        field: 'short_title',
        value: `'{"es": "Ejemplo revisado"}'`,
      });
      expect(
        (await client.query('SELECT short_title FROM app.criteria WHERE id = $1', [live.criterion]))
          .rows,
      ).toEqual([{ short_title: { es: 'Ejemplo revisado' } }]);
    });
  });

  it("changes an election's intro through a change request, only with text in the default locale", async () => {
    const approving = (value: string) =>
      actingAs(USERS.countryAdminA, async (client) => {
        await setActor(client, USERS.editorA);
        const id = await propose(client, {
          kind: 'election',
          target: live.id,
          field: 'intro',
          value,
        });
        await setActor(client, USERS.countryAdminA);
        const code = await errorCode(client, decide(id));
        const { rows } = await client.query('SELECT intro FROM app.elections WHERE id = $1', [
          live.id,
        ]);
        return { code, intro: rows[0]?.intro };
      });
    expect(await approving(`'{"en": "Example intro"}'`)).toEqual({
      code: CHECK_VIOLATION,
      intro: null,
    });
    expect(await approving(`'{"es": "Introducción revisada"}'`)).toEqual({
      code: null,
      intro: { es: 'Introducción revisada' },
    });
  });

  it('adds a criterion only with its short title in the default locale', async () => {
    const criterion = (shortTitle: string) =>
      `'{"slug": "criterio-de-ejemplo-3", "title": {"es": "Criterio de ejemplo 3"}, ${shortTitle}
         "description": {"es": "Descripción de ejemplo"}, "display_order": 3}'`;
    const codes = await Promise.all(
      ['', `"short_title": {"en": "Example 3"},`, `"short_title": {"es": "Ejemplo 3"},`].map(
        (shortTitle) =>
          actingAs(USERS.countryAdminA, async (client) => {
            await setActor(client, USERS.editorA);
            const id = await propose(client, {
              action: 'add',
              kind: 'criterion',
              target: null,
              field: null,
              value: criterion(shortTitle),
            });
            await setActor(client, USERS.countryAdminA);
            return errorCode(client, decide(id));
          }),
      ),
    );
    expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION, null]);
  });

  it('adds an external reviewer once: the same row again needs another request', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await proposedThenApproved(client, {
        action: 'add',
        kind: 'methodology_reviewer',
        target: null,
        field: null,
        value: `'{"name": "Otra Persona Revisora", "affiliation": "Universidad de Ejemplo"}'`,
      });
      expect(
        await errorCode(
          client,
          `INSERT INTO app.methodology_reviewers (tenant_id, methodology_id, name, affiliation)
           VALUES ('${TENANT_A}', '${live.methodology}', 'Otra Persona Revisora', 'Universidad de Ejemplo')`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('retires an external reviewer', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await proposedThenApproved(client, {
        action: 'retire',
        kind: 'methodology_reviewer',
        target: live.reviewer,
        field: null,
        value: 'NULL',
      });
      expect(
        (
          await client.query(
            'SELECT retired_at = now() AS now FROM app.methodology_reviewers WHERE id = $1',
            [live.reviewer],
          )
        ).rows,
      ).toEqual([{ now: true }]);
    });
  });

  it('is open to the proposer, unless a platform admin makes the tenant require a second approver', async () => {
    const codes = await actingAs(USERS.countryAdminA, async (client) => {
      const own = await propose(client);
      const first = await errorCode(client, decide(own));
      await setActor(client, USERS.platformAdmin);
      await client.query(
        'UPDATE app.tenants SET live_edits_need_second_approver = true WHERE id = $1',
        [TENANT_A],
      );
      await setActor(client, USERS.countryAdminA);
      const again = await propose(client, { field: 'display_order', value: `'7'` });
      return [first, await errorCode(client, decide(again))];
    });
    expect(codes).toEqual([null, INSUFFICIENT_PRIVILEGE]);
  });

  it('is refused to a reviewer, who could not make the change', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const id = await propose(client);
        await setActor(client, USERS.reviewerA);
        return errorCode(client, decide(id));
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is refused to an editor who is also a reviewer, though they could decide and make the change', async () => {
    const codes = await inRolledBackTransaction(async (client) => {
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      // Given by the country admin, who is stamped as its creator.
      await setActor(client, USERS.countryAdminA);
      await client.query(
        `INSERT INTO app.memberships (tenant_id, user_id, role) VALUES ($1, $2, 'reviewer')`,
        [TENANT_A, USERS.editorA],
      );
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await setActor(client, USERS.countryAdminA);
      const others = await propose(client);
      await setActor(client, USERS.editorA);
      const own = await propose(client, { field: 'display_order', value: `'7'` });
      return [
        await errorCode(client, decide(others)),
        await errorCode(client, decide(own)),
        // Rejecting stays theirs, as a reviewer's.
        await errorCode(client, decide(others, 'rejected')),
      ];
    });
    expect(codes).toEqual([INSUFFICIENT_PRIVILEGE, INSUFFICIENT_PRIVILEGE, null]);
  });

  it('is refused inside the freeze window', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const id = await propose(client);
        await client.query('UPDATE app.elections SET frozen_from = now() WHERE id = $1', [live.id]);
        return errorCode(client, decide(id));
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('is refused once the target has changed since the proposal', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const first = await propose(client);
        const second = await propose(client, { value: `'{"es": "PE-B2"}'` });
        await client.query(decide(first));
        return errorCode(client, decide(second));
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('waits for another approval of the same target, then is refused as stale, not applied over it', async () => {
    const first = new pg.Client({ connectionString: superuserUrl() });
    const second = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([first.connect(), second.connect()]);
    const begin = async (client: pg.Client) => {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await setActor(client, USERS.countryAdminA);
    };
    const { rows: before } = await first.query<{ website: string | null }>(
      'SELECT website FROM app.parties WHERE id = $1',
      [live.secondParty],
    );
    const ids: string[] = [];
    try {
      // Two pending proposals for one field, each from its current value, as two admins would see them.
      await begin(first);
      ids.push(
        await propose(first, { field: 'website', value: `'"https://uno.example.org"'` }),
        await propose(first, { field: 'website', value: `'"https://dos.example.org"'` }),
      );
      await first.query('COMMIT');
      await begin(first);
      await first.query(decide(ids[0]!));
      const { rows: backend } = await second.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      await begin(second);
      const waiting = errorCode(second, decide(ids[1]!));
      // Only once the second waits on the first is it a race: then the first commits.
      await expect
        .poll(() =>
          inRolledBackTransaction(async (watcher) => {
            const { rows } = await watcher.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`,
              [backend[0]?.pid],
            );
            return rows[0]?.n;
          }),
        )
        .toBe(1);
      await first.query('COMMIT');
      expect(await waiting).toBe(RESTRICT_VIOLATION);
      await second.query('ROLLBACK');
      const { rows: after } = await first.query(
        `SELECT p.website, s.previous_value, s.new_value FROM app.parties p
           JOIN app.structural_changes s ON s.target_id = p.id AND s.change_request_id = ANY ($2)
          WHERE p.id = $1`,
        [live.secondParty, ids],
      );
      expect(after).toEqual([
        {
          website: 'https://uno.example.org',
          previous_value: before[0]?.website ?? null,
          new_value: 'https://uno.example.org',
        },
      ]);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      // What this test committed, undone around the rules that keep it (as the owner of the test database would).
      await first.query('BEGIN');
      await first.query('SET LOCAL session_replication_role = replica');
      await first.query('DELETE FROM app.structural_changes WHERE change_request_id = ANY ($1)', [
        ids,
      ]);
      await first.query('DELETE FROM app.change_requests WHERE id = ANY ($1)', [ids]);
      await first.query('UPDATE app.parties SET website = $2 WHERE id = $1', [
        live.secondParty,
        before[0]?.website ?? null,
      ]);
      await first.query('COMMIT');
      await Promise.all([first.end(), second.end()]);
    }
  });

  it('locks its target no more than the write it approves: what points at the target can still be added', async () => {
    const first = new pg.Client({ connectionString: superuserUrl() });
    const second = new pg.Client({ connectionString: superuserUrl() });
    await Promise.all([first.connect(), second.connect()]);
    try {
      for (const client of [first, second]) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE aiontheballot_admin');
        await setActor(client, USERS.countryAdminA);
      }
      // An approval of the election's own name, holding its lock until it commits.
      const id = await propose(first, {
        kind: 'election',
        target: live.id,
        field: 'name',
        value: `'{"es": "Elecciones renombradas de ejemplo"}'`,
      });
      await first.query(decide(id));
      // Meanwhile, a request for the same election: its foreign key takes KEY SHARE on the election's row, which
      // FOR UPDATE would hold up (and two such requests applied at once would deadlock on).
      await second.query(`SET LOCAL lock_timeout = '2s'`);
      expect(
        await errorCode(second, proposeSql({ field: 'display_order', value: `'8'` })),
      ).toBeNull();
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      await Promise.all([first.end(), second.end()]);
    }
  });

  it.each<[string, Proposal]>([
    ['a public note without the default locale', { note: `'{"en": "Example note"}'` }],
    ['a text without the default locale', { value: `'{"en": "EP-B"}'` }],
  ])('is refused with %s', async (_name, proposal) => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) =>
        errorCode(client, decide(await propose(client, proposal))),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('happens once: a decided request never changes again', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const approved = await proposedThenApproved(client);
      expect(await errorCode(client, decide(approved, 'rejected'))).toBe(RESTRICT_VIOLATION);
      const rejected = await propose(client, { field: 'display_order', value: `'7'` });
      await client.query(decide(rejected, 'rejected'));
      expect(await errorCode(client, decide(rejected))).toBe(RESTRICT_VIOLATION);
      expect(
        (await client.query('DELETE FROM app.change_requests WHERE id = $1', [rejected])).rowCount,
      ).toBe(0);
    });
  });
});

describe('structural changes', () => {
  it('are written only by an approval, and never change', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const id = await propose(client);
      expect(
        await errorCode(
          client,
          `INSERT INTO app.structural_changes (tenant_id, election_id, change_request_id, action, target_kind,
                                               target_id, public_note)
           VALUES ('${TENANT_A}', '${live.id}', '${id}', 'update', 'party', '${live.secondParty}', ${NOTE})`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(await errorCode(client, `UPDATE app.structural_changes SET field = 'name'`)).toBe(
        RESTRICT_VIOLATION,
      );
      expect(await errorCode(client, 'DELETE FROM app.structural_changes')).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });
});

describe('the corrections log', () => {
  it('shows the public every structural change and later revision of an election, newest first', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      // A correction of the published cell, after the fixture's approved change.
      const cell = CELLS.A.published;
      await client.query(
        `UPDATE app.assessments SET draft_change_kind = 'correction', draft_public_note = ${NOTE} WHERE id = $1`,
        [cell],
      );
      await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [cell]);
      await setActor(client, USERS.reviewerA);
      await client.query(
        `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
         SELECT id, content_version FROM app.assessments WHERE id = $1`,
        [cell],
      );
      await client.query('SET LOCAL ROLE aiontheballot_web');
      const { rows } = await client.query(
        `SELECT entry_kind, change FROM app.corrections_log WHERE election_id = $1`,
        [live.id],
      );
      expect(rows).toEqual([
        { entry_kind: 'revision', change: 'correction' },
        { entry_kind: 'structural_change', change: 'update' },
      ]);
    });
  });
});
