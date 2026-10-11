import type { DB } from '@aiontheballot/db/generated/db';

import { withActor } from '@aiontheballot/db/actor';
import { createDatabase } from '@aiontheballot/db/client';
import { sql, type Transaction } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';

import {
  createDocument,
  deleteDocument,
  listDocuments,
  updateDocument,
  updateSettings,
} from '../src/admin/settings.js';
import { inRolledBackTransaction } from './db.js';
import { TENANT_A, USERS } from './fixtures.js';

/** As `userId` through the admin role, the way withActor sets it. */
const actAs = async (trx: Transaction<DB>, userId: string, aal: 1 | 2 = 2) => {
  await sql`SET LOCAL ROLE aiontheballot_admin`.execute(trx);
  await sql`SELECT set_config('app.user_id', ${userId}, true), set_config('app.aal', ${String(aal)}, true)`.execute(
    trx,
  );
};

const settingsOfA = async (trx: Transaction<DB>) => {
  await sql`RESET ROLE`.execute(trx);
  const { rows } = await sql<{ days: number; second: boolean }>`
    SELECT report_retention_days AS days, live_edits_need_second_approver AS second
      FROM app.tenants WHERE id = ${TENANT_A}`.execute(trx);
  return rows[0];
};

/** A's fixture texts: a published privacy policy and a newer draft of it. */
const PUBLISHED_A = '0190f8c4-0000-7000-8000-000000000501';
const DRAFT_A = '0190f8c4-0000-7000-8000-000000000502';

describe("a tenant's settings (editorial workflow T3, P1)", () => {
  it('let a country admin change how long reports are kept, and audit it', async () => {
    const { result, after, audited } = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      const changed = await updateSettings(trx, TENANT_A, { reportRetentionDays: 30 });
      const settings = await settingsOfA(trx);
      const { rows } = await sql<{ diff: unknown }>`
        SELECT diff FROM app.audit_log WHERE table_name = 'tenants' AND row_id = ${TENANT_A}
         ORDER BY id DESC LIMIT 1`.execute(trx);
      return { result: changed, after: settings, audited: rows[0]?.diff };
    });
    expect(result).toBe('changed');
    expect(after?.days).toBe(30);
    expect(audited).toMatchObject({ new: { report_retention_days: 30 } });
  });

  it('change nothing for an editor or a reviewer', async () => {
    for (const userId of [USERS.editorA, USERS.reviewerA]) {
      const { result, before, after } = await inRolledBackTransaction(async (trx) => {
        const was = await settingsOfA(trx);
        await actAs(trx, userId);
        const changed = await updateSettings(trx, TENANT_A, { reportRetentionDays: 30 });
        return { result: changed, before: was, after: await settingsOfA(trx) };
      });
      expect(result).toBe('forbidden');
      expect(after).toEqual(before);
    }
  });

  it('leave whether live edits need a second approver to platform admins (P1.1)', async () => {
    const countryAdmin = inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      return updateSettings(trx, TENANT_A, { liveEditsNeedSecondApprover: true });
    });
    await expect(countryAdmin).rejects.toMatchObject({ code: '42501' });
    const { result, after } = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.platformAdmin);
      const changed = await updateSettings(trx, TENANT_A, { liveEditsNeedSecondApprover: true });
      return { result: changed, after: await settingsOfA(trx) };
    });
    expect(result).toBe('changed');
    expect(after?.second).toBe(true);
  });
});

describe("the operator's texts (editorial workflow T2)", () => {
  it('are read by every member, newest version first', async () => {
    const documents = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.reviewerA);
      return listDocuments(trx, TENANT_A);
    });
    expect(documents.map((d) => [d.id, d.publishedAt === null])).toEqual([
      [DRAFT_A, true],
      [PUBLISHED_A, false],
    ]);
    expect(documents[0]?.version).toBeGreaterThan(documents[1]?.version ?? Infinity);
  });

  it('start a version only while no draft of the kind exists', async () => {
    const results = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      const body = { es: 'Política de ejemplo, versión nueva' };
      const blocked = await createDocument(trx, TENANT_A, 'privacy_policy', body, false);
      const other = await createDocument(trx, TENANT_A, 'about_operator', body, false);
      expect(await deleteDocument(trx, TENANT_A, DRAFT_A)).toBe('changed');
      const next = await createDocument(trx, TENANT_A, 'privacy_policy', body, false);
      return { blocked, other, next };
    });
    expect(results.blocked).toBe('draft-exists');
    expect(results.other).toMatchObject({ id: expect.any(String) });
    expect(results.next).toMatchObject({ id: expect.any(String) });
  });

  it('publish a draft with the text saved in the same statement, and never change it afterwards', async () => {
    const results = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      const published = await updateDocument(
        trx,
        TENANT_A,
        DRAFT_A,
        { es: 'Política de ejemplo, publicada' },
        true,
      );
      const [latest] = (await listDocuments(trx, TENANT_A)).filter((d) => d.id === DRAFT_A);
      const again = await updateDocument(trx, TENANT_A, DRAFT_A, { es: 'Otro texto' }, false);
      const removed = await deleteDocument(trx, TENANT_A, PUBLISHED_A);
      return { published, latest, again, removed };
    });
    expect(results.published).toBe('changed');
    expect(results.latest).toMatchObject({
      body: { es: 'Política de ejemplo, publicada' },
      publishedAt: expect.any(String),
    });
    expect(results.again).toBe('stale');
    expect(results.removed).toBe('stale');
  });

  it("refuse to publish without the tenant's default language", async () => {
    const publish = inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      return updateDocument(trx, TENANT_A, DRAFT_A, { en: 'Example policy' }, true);
    });
    await expect(publish).rejects.toMatchObject({ code: '23514' });
    const saved = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.countryAdminA);
      return updateDocument(trx, TENANT_A, DRAFT_A, { en: 'Example policy' }, false);
    });
    expect(saved).toBe('changed');
  });

  it('change nothing for an editor, and nothing that is gone', async () => {
    const results = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      const update = await updateDocument(
        trx,
        TENANT_A,
        DRAFT_A,
        { es: 'Texto de ejemplo' },
        false,
      );
      const remove = await deleteDocument(trx, TENANT_A, DRAFT_A);
      await actAs(trx, USERS.countryAdminA);
      const missing = await deleteDocument(trx, TENANT_A, crypto.randomUUID());
      return { update, remove, missing };
    });
    expect(results).toEqual({ update: 'forbidden', remove: 'forbidden', missing: 'not-found' });
    // An editor can't take the lock only those who write texts can, so nothing is even tried.
    const create = await inRolledBackTransaction(async (trx) => {
      await actAs(trx, USERS.editorA);
      return createDocument(trx, TENANT_A, 'about_operator', { es: 'Texto de ejemplo' }, false);
    });
    expect(create).toBe('forbidden');
  });
});

describe('two drafts of a text started at once', () => {
  const env = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not set. Copy .env.example to .env.`);
    }
    return value;
  };
  const admin = createDatabase({
    connectionString: env('TEST_ADMIN_DATABASE_URL'),
    maxConnections: 2,
  });
  const owner = createDatabase({
    connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
    maxConnections: 1,
  });

  afterAll(async () => {
    await admin.destroy();
    await owner.destroy();
  });

  it('run one after the other, so the second finds the first and is refused as such', async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = () => {};
    const started = new Promise<void>((resolve) => {
      held = resolve;
    });
    const start = (wait?: Promise<void>) =>
      withActor(admin, { userId: USERS.countryAdminA, aal: 2 }, async (trx) => {
        const result = await createDocument(
          trx,
          TENANT_A,
          'about_operator',
          { es: 'Sobre la organización de ejemplo' },
          false,
        );
        held();
        await wait;
        return result;
      }).catch((error: unknown) => (error as { code?: string }).code ?? 'unexpected');
    try {
      const first = start(hold);
      await started;
      const second = start();
      // Until the second waits for the first's lock (or, without one, a few seconds pass and it fails below).
      for (let tries = 0; tries < 100; tries += 1) {
        const { rows } = await sql<{ n: string }>`
          SELECT count(*) AS n FROM pg_stat_activity
           WHERE usename = 'aiontheballot_admin' AND wait_event_type = 'Lock'`.execute(owner);
        if (Number(rows[0]?.n) > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      release();
      expect(await first).toMatchObject({ id: expect.any(String) });
      expect(await second).toBe('draft-exists');
    } finally {
      await sql`DELETE FROM app.tenant_documents
                 WHERE tenant_id = ${TENANT_A} AND kind = 'about_operator'`.execute(owner);
    }
  });
});
