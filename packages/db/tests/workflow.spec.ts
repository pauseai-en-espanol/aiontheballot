import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, FILES, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';
const LOCK_NOT_AVAILABLE = '55P03';

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

/** Runs `fn` as another role (the superuser by default), for setup the principal under test may not do. */
const asRole = async <T>(client: pg.Client, fn: () => Promise<T>, role?: string): Promise<T> => {
  await client.query(role ? `SET LOCAL ROLE ${role}` : 'RESET ROLE');
  const result = await fn();
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  return result;
};

/** Archives A's live election, as its country admin, keeping the acting user. */
const archiveLiveA = async (client: pg.Client): Promise<void> => {
  const { rows } = await client.query<{ actor: string }>(
    `SELECT current_setting('app.user_id') AS actor`,
  );
  await setActor(client, USERS.countryAdminA);
  await client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [A.election.id]);
  await setActor(client, rows[0]!.actor);
};

/**
 * What the publish trigger does to the cell, done as the table owner: the only role that may set a cell published.
 * The publish INSERT itself comes with the revision tables.
 */
const publishAsOwner = (client: pg.Client, cell: string): Promise<unknown> =>
  asRole(
    client,
    () => client.query(`UPDATE app.assessments SET state = 'published' WHERE id = $1`, [cell]),
    'aiontheballot_owner',
  );

const A = CELLS.A;
const draftA = ELECTIONS.draftA;

const cell = async (client: pg.Client, id: string) =>
  (
    await client.query<{
      state: string;
      content_version: number;
      generation: number;
      draft_change_kind: string | null;
      draft_public_note: unknown;
    }>(
      `SELECT state, content_version, generation, draft_change_kind, draft_public_note FROM app.assessments
        WHERE id = $1`,
      [id],
    )
  ).rows[0];

const version = async (client: pg.Client, id: string): Promise<number> =>
  (await cell(client, id))?.content_version ?? Number.NaN;

const contributors = async (client: pg.Client, id: string): Promise<string[]> =>
  (
    await client.query<{ entry: string }>(
      `SELECT generation || ' ' || user_id AS entry FROM app.assessment_contributors WHERE assessment_id = $1
        ORDER BY 1`,
      [id],
    )
  ).rows.map((r) => r.entry);

const events = async (client: pg.Client, id: string) =>
  (
    await client.query<{ kind: string; actor_id: string; note: string | null }>(
      `SELECT kind, actor_id, note FROM app.review_events WHERE assessment_id = $1 ORDER BY id`,
      [id],
    )
  ).rows;

const submit = (id: string): string =>
  `UPDATE app.assessments SET state = 'in_review' WHERE id = '${id}'`;

/**
 * A stored, extracted source in A's draft election (where structure may change freely), added as the superuser: a
 * party's own document, or a party-neutral one.
 */
const storedSource = (
  client: pg.Client,
  { party, kind = 'pdf' }: { party: string | null; kind?: string },
): Promise<string> =>
  asRole(client, async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, is_programme)
       VALUES ($1, $2, $3, $4, 'Documento de ejemplo', $5) RETURNING id`,
      [TENANT_A, draftA.id, party, kind, party !== null],
    );
    const id = rows[0]!.id;
    await client.query(
      `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
      [FILES.sourceA.id, id],
    );
    await client.query(
      `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
       VALUES ($1, $2, 1, 'p. 1', 'Una frase de ejemplo lo bastante larga para citarla.')`,
      [id, TENANT_A],
    );
    await client.query(`UPDATE app.source_documents SET extraction_status = 'done' WHERE id = $1`, [
      id,
    ]);
    return id;
  });

/** A new cell in A's draft election, on its first party and criterion, written by the acting user. */
const newCell = async (client: pg.Client, rating: string | null): Promise<string> =>
  (
    await client.query<{ id: string }>(
      `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
       VALUES ($1, $2, $3, $4, $5, '{"es": "Resumen de ejemplo"}') RETURNING id`,
      [TENANT_A, draftA.id, draftA.party, draftA.criterion, rating],
    )
  ).rows[0]!.id;

const quote = (cellId: string, source: string, ordinal = 1): string =>
  `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
   VALUES ('${TENANT_A}', '${draftA.id}', '${cellId}', '${source}', ${ordinal},
           'Una frase de ejemplo lo bastante larga')`;

const check = (cellId: string, source: string): string =>
  `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
   VALUES ('${cellId}', '${TENANT_A}', '${draftA.id}', '${source}')`;

/** Content changes to A's draft cell, one of each kind. */
const DRAFT_EDITS: readonly [string, string][] = [
  [
    'its summary',
    `UPDATE app.assessments SET draft_summary = '{"es": "Otro resumen"}' WHERE id = '${A.draft}'`,
  ],
  [
    'a new quote',
    `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
     VALUES ('${TENANT_A}', '${A.election.id}', '${A.draft}', '${A.source.id}', 5, '${A.quote}')`,
  ],
  [
    'a quote',
    `UPDATE app.draft_evidence SET section_label = 'Sección' WHERE id = '${A.draftEvidence}'`,
  ],
  ['a deleted quote', `DELETE FROM app.draft_evidence WHERE id = '${A.draftEvidence}'`],
  [
    'a deleted checked document',
    `DELETE FROM app.draft_checked_documents WHERE assessment_id = '${A.draft}'`,
  ],
];

describe('editing a cell', () => {
  it.each(DRAFT_EDITS)(
    'through %s bumps its version and adds the editor as a contributor of the generation',
    async (_name, sql) => {
      await actingAs(USERS.countryAdminA, async (client) => {
        const before = await version(client, A.draft);
        await client.query(sql);
        expect(await version(client, A.draft)).toBe(before + 1);
        expect(await contributors(client, A.draft)).toEqual(
          [`0 ${USERS.editorA}`, `0 ${USERS.countryAdminA}`].sort(),
        );
      });
    },
  );

  it('through a checked document bumps its version', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const before = await version(client, A.draft);
      await client.query(`DELETE FROM app.draft_checked_documents WHERE assessment_id = $1`, [
        A.draft,
      ]);
      await client.query(
        `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
         VALUES ($1, $2, $3, $4)`,
        [A.draft, TENANT_A, A.election.id, A.source.id],
      );
      expect(await version(client, A.draft)).toBe(before + 2);
    });
  });

  it('is not a contribution when a reviewer attests a quote, even in review', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const before = await version(client, A.review);
      await client.query(`UPDATE app.draft_evidence SET attested_by = $1 WHERE id = $2`, [
        USERS.reviewerA,
        A.evidence,
      ]);
      expect(await version(client, A.review)).toBe(before);
      expect(await contributors(client, A.review)).toEqual([`0 ${USERS.editorA}`]);
    });
  });

  it('is not a contribution when only the recheck flag changes', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const before = await version(client, A.review);
      await client.query(`UPDATE app.assessments SET recheck_reason = 'Revisar' WHERE id = $1`, [
        A.review,
      ]);
      expect(await version(client, A.review)).toBe(before);
      expect(await contributors(client, A.review)).toEqual([`0 ${USERS.editorA}`]);
    });
  });

  it.each([
    [
      'its rating',
      `UPDATE app.assessments SET draft_rating = 'does_not_meet' WHERE id = '${A.review}'`,
    ],
    [
      'a new quote',
      `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES ('${TENANT_A}', '${A.election.id}', '${A.review}', '${A.source.id}', 5, '${A.quote}')`,
    ],
    [
      'a quote',
      `UPDATE app.draft_evidence SET section_label = 'Sección' WHERE id = '${A.evidence}'`,
    ],
    ['a deleted quote', `DELETE FROM app.draft_evidence WHERE id = '${A.evidence}'`],
    [
      'a checked document',
      `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
       VALUES ('${A.review}', '${TENANT_A}', '${A.election.id}', '${A.source.id}')`,
    ],
  ])('is refused while it is in review: %s', async (_name, sql) => {
    expect(await actingAs(USERS.editorA, (c) => errorCode(c, sql))).toBe(RESTRICT_VIOLATION);
  });

  it.each([
    [
      'a quote',
      `UPDATE app.draft_evidence SET section_label = 'Sección' WHERE id = '${A.draftEvidence}'`,
    ],
    [
      'a checked document',
      `DELETE FROM app.draft_checked_documents WHERE assessment_id = '${A.draft}'`,
    ],
  ])('through %s locks the cell row first', async (_name, sql) => {
    await inRolledBackTransaction(async (holder) => {
      // KEY SHARE conflicts with FOR UPDATE, but not with the lock a plain UPDATE of the cell takes.
      await holder.query('SELECT 1 FROM app.assessments WHERE id = $1 FOR KEY SHARE', [A.draft]);
      await actingAs(USERS.editorA, async (client) => {
        await client.query(`SET LOCAL lock_timeout = '200ms'`);
        expect(await errorCode(client, sql)).toBe(LOCK_NOT_AVAILABLE);
      });
    });
  });

  it('keeps its rating on the methodology scale', async () => {
    const codes = await actingAs(USERS.editorA, async (client) => [
      await errorCode(
        client,
        `UPDATE app.assessments SET draft_rating = 'green' WHERE id = '${A.draft}'`,
      ),
      await errorCode(
        client,
        `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating)
         VALUES ('${TENANT_A}', '${draftA.id}', '${draftA.party}', '${draftA.criterion}', 'yellow')`,
      ),
    ]);
    expect(codes).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
  });

  it('takes its generation and version from the workflow only, even from the superuser', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const before = await version(client, A.draft);
      await asRole(client, () =>
        client.query(
          `UPDATE app.assessments SET generation = 9, content_version = 99 WHERE id = $1`,
          [A.draft],
        ),
      );
      expect(await cell(client, A.draft)).toMatchObject({ generation: 0, content_version: before });
    });
  });

  it('starts as a draft of generation 0, created by a contributor', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const id = await newCell(client, 'meets');
      expect(await cell(client, id)).toMatchObject({
        state: 'draft',
        generation: 0,
        content_version: 0,
      });
      expect(await contributors(client, id)).toEqual([`0 ${USERS.countryAdminA}`]);
      await asRole(client, async () => {
        expect(
          await errorCode(
            client,
            `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, state)
             VALUES ('${TENANT_A}', '${draftA.id}', '${draftA.secondParty}', '${draftA.criterion}', 'in_review')`,
          ),
        ).toBe(RESTRICT_VIOLATION);
      });
    });
  });
});

describe('submitting a cell', () => {
  it('moves a draft into review and records who submitted it, without making them a contributor', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await client.query(submit(A.draft));
      expect((await cell(client, A.draft))?.state).toBe('in_review');
      expect(await events(client, A.draft)).toEqual([
        { kind: 'submitted', actor_id: USERS.countryAdminA, note: null },
      ]);
      expect(await contributors(client, A.draft)).toEqual([`0 ${USERS.editorA}`]);
    });
  });

  it('is for editors and country admins, not reviewers', async () => {
    expect(await actingAs(USERS.reviewerA, (c) => errorCode(c, submit(A.draft)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('accepts "not mentioned" backed by a checked copy of the party\'s own document', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const source = await storedSource(client, { party: draftA.party });
      const id = await newCell(client, 'not_mentioned');
      await client.query(check(id, source));
      expect(await errorCode(client, submit(id))).toBeNull();
    });
  });

  it('accepts a rating backed by a quote', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const source = await storedSource(client, { party: draftA.party });
      const id = await newCell(client, 'meets');
      await client.query(quote(id, source));
      expect(await errorCode(client, submit(id))).toBeNull();
    });
  });

  it.each([
    ['without a rating', null, async () => 'SELECT 1'],
    [
      'without a summary in the default locale',
      'not_mentioned',
      async (c: pg.Client, id: string) => {
        await c.query(check(id, await storedSource(c, { party: draftA.party })));
        return `UPDATE app.assessments SET draft_summary = '{"en": "Example summary"}' WHERE id = '${id}'`;
      },
    ],
    ['rated without a quote', 'meets', async () => 'SELECT 1'],
    ['"not mentioned" without a checked document', 'not_mentioned', async () => 'SELECT 1'],
    [
      '"not mentioned" backed by a document with no stored copy',
      'not_mentioned',
      async (c: pg.Client, id: string) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
           VALUES ($1, $2, $3, 'pdf', 'Documento sin copia') RETURNING id`,
          [TENANT_A, draftA.id, draftA.party],
        );
        return check(id, rows[0]!.id);
      },
    ],
    [
      '"not mentioned" backed by a party-neutral document',
      'not_mentioned',
      async (c: pg.Client, id: string) => check(id, await storedSource(c, { party: null })),
    ],
    [
      '"not mentioned" backed by a kind the methodology excludes',
      'not_mentioned',
      async (c: pg.Client, id: string) => {
        await c.query(check(id, await storedSource(c, { party: draftA.party })));
        return `UPDATE app.methodologies SET not_mentioned_source_kinds = '{web_page}' WHERE id = '${draftA.methodology}'`;
      },
    ],
    [
      'with a change kind before its first publish',
      'not_mentioned',
      async (c: pg.Client, id: string) => {
        await c.query(check(id, await storedSource(c, { party: draftA.party })));
        return `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota"}'
                 WHERE id = '${id}'`;
      },
    ],
  ])('is refused %s', async (_name, rating, prepare) => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const id = await newCell(client, rating);
        await client.query(await prepare(client, id));
        return errorCode(client, submit(id));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  describe('after the first publish', () => {
    /** A's cell in review, published, then edited (so a draft of generation 1) with `set`. */
    const republish = (set: string): Promise<string | null> =>
      actingAs(USERS.editorA, async (client) => {
        await publishAsOwner(client, A.review);
        await client.query(`UPDATE app.assessments SET ${set} WHERE id = $1`, [A.review]);
        return errorCode(client, submit(A.review));
      });

    it('accepts an update with a public note', async () => {
      expect(
        await republish(
          `draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'`,
        ),
      ).toBeNull();
    });

    it('accepts a withdrawal, which has no rating and needs no evidence', async () => {
      expect(
        await republish(
          `draft_rating = NULL, draft_change_kind = 'withdrawal', draft_public_note = '{"es": "Nota de ejemplo"}'`,
        ),
      ).toBeNull();
    });

    it.each([
      ['without a change kind', `draft_summary = '{"es": "Otro resumen"}'`],
      [
        'as "initial"',
        `draft_change_kind = 'initial', draft_public_note = '{"es": "Nota de ejemplo"}'`,
      ],
      ['without a public note', `draft_change_kind = 'correction'`],
      [
        'without a public note in the default locale',
        `draft_change_kind = 'correction', draft_public_note = '{"en": "Example note"}'`,
      ],
      [
        'as a withdrawal that keeps a rating',
        `draft_change_kind = 'withdrawal', draft_public_note = '{"es": "Nota de ejemplo"}'`,
      ],
    ])('is refused %s', async (_name, set) => {
      expect(await republish(set)).toBe(CHECK_VIOLATION);
    });
  });
});

describe('a cell in review', () => {
  it('is recalled to draft by a contributor', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      expect((await cell(client, A.review))?.state).toBe('draft');
      expect((await events(client, A.review)).at(-1)).toEqual({
        kind: 'recalled',
        actor_id: USERS.editorA,
        note: null,
      });
    });
  });

  it('is rejected by a reviewer with a note, written as a comment in the same transaction', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await client.query(
        `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
         VALUES ($1, $2, 'commented', 'Falta una cita del programa')`,
        [TENANT_A, A.review],
      );
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      expect((await events(client, A.review)).at(-1)).toEqual({
        kind: 'rejected',
        actor_id: USERS.reviewerA,
        note: 'Falta una cita del programa',
      });
      expect(await contributors(client, A.review)).toEqual([`0 ${USERS.editorA}`]);
    });
  });

  it('is not rejected without a note', async () => {
    expect(
      await actingAs(USERS.reviewerA, (c) =>
        errorCode(c, `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('is not rejected with a note from an earlier transaction', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      // A comment from an earlier transaction, inserted with the triggers off so it keeps its old time.
      await asRole(client, async () => {
        await client.query(`SET LOCAL session_replication_role = replica`);
        await client.query(
          `INSERT INTO app.review_events (tenant_id, assessment_id, kind, actor_id, note, created_at)
           VALUES ($1, $2, 'commented', $3, 'Comentario antiguo', now() - interval '1 day')`,
          [TENANT_A, A.review, USERS.reviewerA],
        );
        await client.query(`SET LOCAL session_replication_role = origin`);
      });
      expect(
        await errorCode(
          client,
          `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("is not rejected with someone else's note", async () => {
    await actingAs(USERS.editorA, async (client) => {
      await client.query(
        `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
         VALUES ($1, $2, 'commented', 'Comentario de otra persona')`,
        [TENANT_A, A.review],
      );
      await setActor(client, USERS.reviewerA);
      expect(
        await errorCode(
          client,
          `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`,
        ),
      ).toBe(CHECK_VIOLATION);
    });
  });

  it('is not moved back by an editor who did not contribute to it', async () => {
    expect(
      await actingAs(USERS.editorAReviewerB, (c) =>
        errorCode(c, `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is never set published by a member, only by the publish trigger', async () => {
    const codes = await Promise.all(
      [USERS.editorA, USERS.reviewerA, USERS.platformAdmin].map((user) =>
        actingAs(user, (c) =>
          errorCode(c, `UPDATE app.assessments SET state = 'published' WHERE id = '${A.review}'`),
        ),
      ),
    );
    expect(codes).toEqual([RESTRICT_VIOLATION, RESTRICT_VIOLATION, RESTRICT_VIOLATION]);
  });

  it('can never be deleted once it has a review trail', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(c, `DELETE FROM app.assessments WHERE id = '${A.review}'`),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('publishing a cell', () => {
  it('starts its next generation, clears the change kind and note, and records the approval', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const before = await version(client, A.review);
      await publishAsOwner(client, A.review);
      expect(await cell(client, A.review)).toMatchObject({
        state: 'published',
        generation: 1,
        content_version: before,
        draft_change_kind: null,
        draft_public_note: null,
      });
      expect((await events(client, A.review)).at(-1)).toEqual({
        kind: 'approved',
        actor_id: USERS.reviewerA,
        note: null,
      });
    });
  });

  it("clears the next generation's change kind and note", async () => {
    await actingAs(USERS.editorA, async (client) => {
      await publishAsOwner(client, A.review);
      await client.query(
        `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`,
        [A.review],
      );
      await client.query(submit(A.review));
      await publishAsOwner(client, A.review);
      expect(await cell(client, A.review)).toMatchObject({
        generation: 2,
        draft_change_kind: null,
        draft_public_note: null,
      });
    });
  });

  it('changes nothing else in the cell', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await asRole(
        client,
        async () => {
          expect(
            await errorCode(
              client,
              `UPDATE app.assessments SET state = 'published', draft_rating = 'does_not_meet' WHERE id = '${A.review}'`,
            ),
          ).toBe(RESTRICT_VIOLATION);
        },
        'aiontheballot_owner',
      );
    });
  });

  it('happens only from review', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await asRole(
        client,
        async () => {
          expect(
            await errorCode(
              client,
              `UPDATE app.assessments SET state = 'published' WHERE id = '${A.draft}'`,
            ),
          ).toBe(RESTRICT_VIOLATION);
        },
        'aiontheballot_owner',
      );
    });
  });
});

describe('a published cell', () => {
  it.each([
    [
      'its summary',
      `UPDATE app.assessments SET draft_summary = '{"es": "Otro resumen"}' WHERE id = '${A.review}'`,
    ],
    [
      'a new quote',
      `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
       VALUES ('${TENANT_A}', '${A.election.id}', '${A.review}', '${A.source.id}', 5, '${A.quote}')`,
    ],
  ])(
    'returns to draft when %s is edited, as a contribution to the new generation',
    async (_name, sql) => {
      await actingAs(USERS.countryAdminA, async (client) => {
        const before = await version(client, A.review);
        await publishAsOwner(client, A.review);
        await client.query(sql);
        expect(await cell(client, A.review)).toMatchObject({
          state: 'draft',
          generation: 1,
          content_version: before + 1,
        });
        expect(await contributors(client, A.review)).toEqual(
          [`0 ${USERS.editorA}`, `1 ${USERS.countryAdminA}`].sort(),
        );
        expect((await events(client, A.review)).at(-1)?.kind).toBe('approved');
      });
    },
  );

  it('is not edited and submitted in one statement', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await publishAsOwner(client, A.review);
      expect(
        await errorCode(
          client,
          `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota"}',
                                      state = 'in_review'
            WHERE id = '${A.review}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('returns to draft only through an edit', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await publishAsOwner(client, A.review);
      expect(
        await errorCode(
          client,
          `UPDATE app.assessments SET state = 'draft' WHERE id = '${A.review}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe('review events', () => {
  it.each(['submitted', 'recalled', 'approved', 'rejected'])(
    'of kind %s are written only by the workflow',
    async (kind) => {
      expect(
        await actingAs(USERS.countryAdminA, (c) =>
          errorCode(
            c,
            `INSERT INTO app.review_events (tenant_id, assessment_id, kind) VALUES ('${TENANT_A}', '${A.review}', '${kind}')`,
          ),
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    },
  );
});

describe('contributors', () => {
  it('are added only for the current generation', async () => {
    const codes = await actingAs(USERS.countryAdminA, async (client) => [
      await errorCode(
        client,
        `INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
         VALUES ('${A.draft}', '${TENANT_A}', 1, '${USERS.countryAdminA}')`,
      ),
      await errorCode(
        client,
        `INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
         VALUES ('${A.draft}', '${TENANT_A}', 0, '${USERS.countryAdminA}')`,
      ),
    ]);
    expect(codes).toEqual([CHECK_VIOLATION, null]);
  });
});

describe('an archived election (P16)', () => {
  /** A's cell in review, published, then its election archived; `fn` runs as editor A. */
  const archived = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
    actingAs(USERS.editorA, async (client) => {
      await publishAsOwner(client, A.review);
      await archiveLiveA(client);
      return fn(client);
    });

  it.each([
    ['', ''],
    [', even as a correction', `'correction'`],
  ])('takes no new cells%s', async (_name, kind) => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating,
                                       draft_change_kind, draft_public_note)
           VALUES ('${TENANT_A}', '${ELECTIONS.archivedA.id}', '${ELECTIONS.archivedA.party}',
                   '${ELECTIONS.archivedA.criterion}', 'meets', ${kind || 'NULL'},
                   ${kind ? `'{"es": "Nota"}'` : 'NULL'})`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it.each([
    ['without a change kind', `draft_summary = '{"es": "Otro resumen"}'`],
    [
      'as an update',
      `draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'`,
    ],
  ])('refuses an edit %s', async (_name, set) => {
    expect(
      await archived((c) =>
        errorCode(c, `UPDATE app.assessments SET ${set} WHERE id = '${A.review}'`),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('accepts a correction, its quotes and its submission', async () => {
    await archived(async (client) => {
      await client.query(
        `UPDATE app.assessments SET draft_change_kind = 'correction', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`,
        [A.review],
      );
      await client.query(`UPDATE app.draft_evidence SET section_label = 'Sección' WHERE id = $1`, [
        A.evidence,
      ]);
      expect(await errorCode(client, submit(A.review))).toBeNull();
    });
  });

  it('refuses a quote for a draft that is not a correction or withdrawal', async () => {
    expect(
      await archived((c) =>
        errorCode(
          c,
          `UPDATE app.draft_evidence SET section_label = 'Sección' WHERE id = '${A.evidence}'`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('refuses to submit an update prepared before it was archived', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await publishAsOwner(client, A.review);
      await client.query(
        `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`,
        [A.review],
      );
      await archiveLiveA(client);
      expect(await errorCode(client, submit(A.review))).toBe(RESTRICT_VIOLATION);
    });
  });
});
