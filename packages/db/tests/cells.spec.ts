import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, LLM_RUNS, SOURCES, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    return fn(client);
  });

const A = CELLS.A;
const evidence = (columns: Record<string, string>): string => {
  const values = {
    tenant_id: `'${TENANT_A}'`,
    election_id: `'${A.election.id}'`,
    assessment_id: `'${A.draft}'`,
    source_document_id: `'${A.source.id}'`,
    ordinal: '2',
    quote: `'${A.quote}'`,
    ...columns,
  };
  return `INSERT INTO app.draft_evidence (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
};

describe('a cell', () => {
  it('is one per party and criterion', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id)
           VALUES ('${TENANT_A}', '${A.election.id}', '${A.election.party}', '${A.election.criterion}')`,
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it('takes its party and criterion from its own election', async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(
          c,
          `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id)
           VALUES ('${TENANT_A}', '${A.election.id}', '${ELECTIONS.draftA.party}', '${A.election.criterion}')`,
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("can't be edited by a reviewer, who only reviews", async () => {
    expect(
      await actingAs(USERS.reviewerA, (c) =>
        errorCode(
          c,
          `UPDATE app.assessments SET draft_rating = 'does_not_meet' WHERE id = '${A.draft}'`,
        ),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is deleted with its drafts and contributors while never published', async () => {
    const left = await actingAs(USERS.editorA, async (client) => {
      await client.query(`DELETE FROM app.assessments WHERE id = $1`, [A.draft]);
      await client.query('RESET ROLE');
      return Promise.all(
        ['draft_checked_documents', 'assessment_contributors'].map(
          async (table) =>
            (await client.query(`SELECT 1 FROM app.${table} WHERE assessment_id = $1`, [A.draft]))
              .rowCount,
        ),
      );
    });
    expect(left).toEqual([0, 0]);
  });
});

describe('a quote', () => {
  it.each([
    ['shorter than 15 characters', { quote: `'Muy corto'` }],
    ['longer than 1000 characters', { quote: `repeat('x', 1001)` }],
    ['from the LLM without its suggestion', { origin: `'llm'` }],
    [
      'typed by hand but pointing at a suggestion',
      { llm_suggestion_id: `'${LLM_RUNS.A.suggestion}'` },
    ],
  ])('is refused when %s', async (_name, columns) => {
    expect(await actingAs(USERS.editorA, (c) => errorCode(c, evidence(columns)))).toBe(
      CHECK_VIOLATION,
    );
  });

  it("comes from a source of the cell's own election", async () => {
    expect(
      await actingAs(USERS.editorA, (c) =>
        errorCode(c, evidence({ source_document_id: `'${SOURCES.draftA.id}'` })),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('records its author from the session', async () => {
    const [row] = await actingAs(
      USERS.editorA,
      async (c) => (await c.query(`${evidence({})} RETURNING created_by`)).rows,
    );
    expect(row).toEqual({ created_by: USERS.editorA });
  });
});

describe('contributors', () => {
  it('can only be added as oneself', async () => {
    const codes = await actingAs(USERS.reviewerA, async (client) => [
      await errorCode(
        client,
        `INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
         VALUES ('${A.review}', '${TENANT_A}', 0, '${USERS.reviewerA}')`,
      ),
      await errorCode(
        client,
        `INSERT INTO app.assessment_contributors (assessment_id, tenant_id, generation, user_id)
         VALUES ('${A.review}', '${TENANT_A}', 0, '${USERS.editorA}')`,
      ),
    ]);
    expect(codes[0]).toBeNull();
    expect(codes[1]).not.toBeNull();
  });

  it('are never changed, not even by the owner', async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_owner');
      expect(
        await errorCode(
          client,
          `UPDATE app.assessment_contributors SET user_id = '${USERS.reviewerA}' WHERE assessment_id = '${A.draft}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe('review events', () => {
  it('record their actor and time from the session, and never change', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note)
         VALUES ($1, $2, 'commented', 'Comentario') RETURNING actor_id, created_at = now() AS now`,
        [TENANT_A, A.review],
      );
      expect(rows).toEqual([{ actor_id: USERS.reviewerA, now: true }]);
      await client.query('RESET ROLE');
      expect(await errorCode(client, `UPDATE app.review_events SET note = 'otro'`)).toBe(
        RESTRICT_VIOLATION,
      );
      expect(await errorCode(client, `DELETE FROM app.review_events`)).toBe(RESTRICT_VIOLATION);
    });
  });
});
