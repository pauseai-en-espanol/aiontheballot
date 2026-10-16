import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, LLM_RUNS, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

const actingAs = <T>(userId: string, fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [userId],
    );
    return fn(client);
  });

const asOwner = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_owner');
    return fn(client);
  });

const newRun = `INSERT INTO app.llm_runs (tenant_id, election_id, source_document_id, model, prompt_version)
                VALUES ('${TENANT_A}', '${LLM_RUNS.A.election.id}', '${LLM_RUNS.A.source.id}', 'modelo-de-ejemplo', 'v1')
                RETURNING requested_by, status`;

describe('LLM runs', () => {
  it('are requested by the actor, queued', async () => {
    const [row] = await actingAs(USERS.editorA, async (c) => (await c.query(newRun)).rows);
    expect(row).toEqual({ requested_by: USERS.editorA, status: 'queued' });
  });

  it("are refused once the tenant's spend this month reaches its cap", async () => {
    const code = await inRolledBackTransaction(async (client) => {
      await client.query(`UPDATE app.llm_runs SET status = 'running' WHERE id = $1`, [
        LLM_RUNS.A.id,
      ]);
      await client.query(`UPDATE app.llm_runs SET status = 'done', cost_usd = 50 WHERE id = $1`, [
        LLM_RUNS.A.id,
      ]);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
        [USERS.editorA],
      );
      return errorCode(client, newRun);
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('are refused when the cap is 0, which turns LLM assistance off', async () => {
    const code = await inRolledBackTransaction(async (client) => {
      await client.query(`UPDATE app.tenants SET llm_monthly_cap_usd = 0 WHERE id = $1`, [
        TENANT_A,
      ]);
      await client.query('SET LOCAL ROLE aiontheballot_admin');
      await client.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
        [USERS.editorA],
      );
      return errorCode(client, newRun);
    });
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('move from queued to running to done or failed, never back', async () => {
    await asOwner(async (client) => {
      const run = `id = '${LLM_RUNS.A.id}'`;
      expect(await errorCode(client, `UPDATE app.llm_runs SET status = 'done' WHERE ${run}`)).toBe(
        RESTRICT_VIOLATION,
      );
      await client.query(`UPDATE app.llm_runs SET status = 'running' WHERE ${run}`);
      await client.query(
        `UPDATE app.llm_runs SET status = 'failed', error = 'tiempo agotado' WHERE ${run}`,
      );
      expect(
        await errorCode(client, `UPDATE app.llm_runs SET status = 'running' WHERE ${run}`),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it("read a source of the run's own election", async () => {
    expect(
      await actingAs(USERS.platformAdmin, (c) =>
        errorCode(
          c,
          `INSERT INTO app.llm_runs (tenant_id, election_id, source_document_id, model, prompt_version)
           VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', '${LLM_RUNS.A.source.id}', 'modelo', 'v1')`,
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('LLM suggestions', () => {
  const suggest = (rating: string, party = LLM_RUNS.A.election.party): string =>
    `INSERT INTO app.llm_suggestions (tenant_id, election_id, run_id, party_id, criterion_id, suggested_rating,
                                      rationale, passages)
     VALUES ('${TENANT_A}', '${LLM_RUNS.A.election.id}', '${LLM_RUNS.A.id}', '${party}',
             '${LLM_RUNS.A.election.criterion}', '${rating}', 'Razonamiento', '[]')`;

  it("suggest a rating of the tenant's scale only", async () => {
    expect(await asOwner((c) => errorCode(c, suggest('green')))).toBe(CHECK_VIOLATION);
    expect(await asOwner((c) => errorCode(c, suggest('not_mentioned')))).toBeNull();
  });

  it("name a party of the run's own election", async () => {
    expect(await asOwner((c) => errorCode(c, suggest('meets', ELECTIONS.draftA.party)))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it('are decided once, by the actor, at the transaction time', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const { rows } = await client.query(
        `UPDATE app.llm_suggestions SET state = 'accepted' WHERE id = $1
         RETURNING decided_by, decided_at = now() AS now`,
        [LLM_RUNS.A.suggestion],
      );
      expect(rows).toEqual([{ decided_by: USERS.editorA, now: true }]);
      expect(
        await errorCode(
          client,
          `UPDATE app.llm_suggestions SET state = 'rejected' WHERE id = '${LLM_RUNS.A.suggestion}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});
