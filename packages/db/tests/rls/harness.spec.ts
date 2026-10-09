import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { inRolledBackTransaction } from '../db.js';
import { type Principal, runCase } from './harness.js';
import { TENANT_A, TENANT_B, USERS } from './matrix.js';

/** Proves the harness itself on a probe table with real policies, before any real table exists. */

const CELL = {
  aDraft: '0190f8c4-0000-7000-8000-0000000002a1',
  aPublished: '0190f8c4-0000-7000-8000-0000000002a2',
  bDraft: '0190f8c4-0000-7000-8000-0000000002b1',
  new: '0190f8c4-0000-7000-8000-0000000002ff',
};

const publicRole: Principal = { id: 'public', role: 'aiontheballot_web' };
const noActor: Principal = { id: 'admin role, no actor', role: 'aiontheballot_admin' };
const editorA: Principal = {
  id: 'editor@A aal2',
  role: 'aiontheballot_admin',
  userId: USERS.editorA,
  aal: 2,
};
const editorAaal1: Principal = {
  id: 'editor@A aal1',
  role: 'aiontheballot_admin',
  userId: USERS.editorA,
  aal: 1,
};

const withProbe = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query(`
      CREATE TABLE app.probe_members (user_id uuid NOT NULL, tenant_id uuid NOT NULL);
      CREATE TABLE app.probe_cells (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, published boolean NOT NULL, note text);
      ALTER TABLE app.probe_members OWNER TO aiontheballot_owner;
      ALTER TABLE app.probe_cells OWNER TO aiontheballot_owner;
      ALTER TABLE app.probe_cells ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON app.probe_cells TO aiontheballot_web;
      GRANT SELECT, INSERT, UPDATE, DELETE ON app.probe_cells TO aiontheballot_admin;
      GRANT SELECT ON app.probe_members TO aiontheballot_admin;
      CREATE POLICY public_read ON app.probe_cells FOR SELECT TO aiontheballot_web USING (published);
      CREATE POLICY member_all ON app.probe_cells FOR ALL TO aiontheballot_admin
        USING (private.current_aal() = 2 AND tenant_id IN (
          SELECT m.tenant_id FROM app.probe_members m WHERE m.user_id = private.current_user_id()))
        WITH CHECK (private.current_aal() = 2 AND tenant_id IN (
          SELECT m.tenant_id FROM app.probe_members m WHERE m.user_id = private.current_user_id()));`);
    await client.query(`INSERT INTO app.probe_members VALUES ($1, $2)`, [USERS.editorA, TENANT_A]);
    await client.query(
      `INSERT INTO app.probe_cells VALUES ($1, $4, false, 'draft A'), ($2, $4, true, 'published A'),
                                          ($3, $5, false, 'draft B')`,
      [CELL.aDraft, CELL.aPublished, CELL.bDraft, TENANT_A, TENANT_B],
    );
    return fn(client);
  });

const read = (id: string) => ({
  sql: 'SELECT id FROM app.probe_cells WHERE id = $1',
  params: [id],
  target: 'SELECT * FROM app.probe_cells WHERE id = $1',
  targetParams: [id],
});

describe('rls harness', () => {
  it('classifies reads', async () => {
    await withProbe(async (client) => {
      expect(await runCase(client, { principal: publicRole, ...read(CELL.aPublished) })).toEqual({
        kind: 'allow',
      });
      expect(await runCase(client, { principal: publicRole, ...read(CELL.aDraft) })).toMatchObject({
        kind: 'deny',
      });
      expect(await runCase(client, { principal: editorA, ...read(CELL.aDraft) })).toEqual({
        kind: 'allow',
      });
      expect(await runCase(client, { principal: editorAaal1, ...read(CELL.aDraft) })).toMatchObject(
        { kind: 'deny' },
      );
      expect(await runCase(client, { principal: editorA, ...read(CELL.bDraft) })).toMatchObject({
        kind: 'deny',
      });
      expect(await runCase(client, { principal: noActor, ...read(CELL.aDraft) })).toMatchObject({
        kind: 'deny',
      });
    });
  });

  it('classifies writes, and checks that denied writes changed nothing', async () => {
    await withProbe(async (client) => {
      const update = (id: string) => ({
        sql: `UPDATE app.probe_cells SET note = 'changed' WHERE id = $1 RETURNING id`,
        params: [id],
        target: 'SELECT * FROM app.probe_cells WHERE id = $1',
        targetParams: [id],
      });
      expect(await runCase(client, { principal: editorA, ...update(CELL.aDraft) })).toEqual({
        kind: 'allow',
      });
      expect(await runCase(client, { principal: editorA, ...update(CELL.bDraft) })).toEqual({
        kind: 'deny',
        reason: 'no-rows',
      });
      expect(
        await runCase(client, {
          principal: editorA,
          sql: `UPDATE app.probe_cells SET tenant_id = $2 WHERE id = $1 RETURNING id`,
          params: [CELL.aDraft, TENANT_B],
          target: 'SELECT * FROM app.probe_cells WHERE id = $1',
          targetParams: [CELL.aDraft],
        }),
      ).toEqual({ kind: 'deny', reason: 'error', code: '42501' });
      const forgedInsert = {
        sql: `INSERT INTO app.probe_cells VALUES ($1, $2, false, 'forged') RETURNING id`,
        params: [CELL.new, TENANT_B],
        target: 'SELECT count(*) AS n FROM app.probe_cells WHERE id = $1',
        targetParams: [CELL.new],
      };
      expect(await runCase(client, { principal: editorA, ...forgedInsert })).toEqual({
        kind: 'deny',
        reason: 'error',
        code: '42501',
      });
      expect(await runCase(client, { principal: publicRole, ...forgedInsert })).toEqual({
        kind: 'deny',
        reason: 'error',
        code: '42501',
      });
    });
  });

  it('refuses to pass when the target is missing', async () => {
    await withProbe(async (client) => {
      await expect(runCase(client, { principal: editorA, ...read(CELL.new) })).rejects.toThrow(
        /exactly one row/,
      );
    });
  });

  it('refuses to pass a "deny" that still changed the target', async () => {
    await withProbe(async (client) => {
      const sneaky = {
        sql: `WITH changed AS (UPDATE app.probe_cells SET note = 'sneaky' WHERE id = $1 RETURNING 1) SELECT 1 WHERE false`,
        params: [CELL.aDraft],
        target: 'SELECT * FROM app.probe_cells WHERE id = $1',
        targetParams: [CELL.aDraft],
      };
      await expect(runCase(client, { principal: editorA, ...sneaky })).rejects.toThrow(
        /target changed/,
      );
    });
  });

  it('refuses to pass an "allow" that touched more than one row', async () => {
    await withProbe(async (client) => {
      const broad = {
        sql: `SELECT id FROM app.probe_cells`,
        target: 'SELECT * FROM app.probe_cells WHERE id = $1',
        targetParams: [CELL.aDraft],
      };
      await expect(runCase(client, { principal: editorA, ...broad })).rejects.toThrow(
        /exactly one row, got 2/,
      );
    });
  });
});
