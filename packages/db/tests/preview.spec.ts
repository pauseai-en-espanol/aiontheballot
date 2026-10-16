import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { superuserUrl } from './env.js';
import { ELECTIONS, FILES, TENANT_A, USERS } from './rls/matrix.js';

// An election in preview (PLAN R181): between draft and live, its site's members see it through the admin's preview,
// as the public will, while it is still edited directly. The public sees none of it; the preview's own role sees it.

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

/** Runs `fn` as `role` (a reader: the public's or the preview's), then returns to the admin role. */
const readingAs = async <T>(
  client: pg.Client,
  role: 'aiontheballot_web' | 'aiontheballot_preview',
  fn: () => Promise<T>,
): Promise<T> => {
  await client.query('RESET ROLE');
  await client.query(`SET LOCAL ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await client.query('RESET ROLE');
    await client.query('SET LOCAL ROLE aiontheballot_admin');
  }
};

/** Runs `fn` as the superuser, then returns to the admin role. */
const asSuperuser = async <T>(client: pg.Client, fn: () => Promise<T>): Promise<T> => {
  await client.query('RESET ROLE');
  try {
    return await fn();
  } finally {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
  }
};

const status = (id: string, to: string): string =>
  `UPDATE app.elections SET status = '${to}' WHERE id = '${id}'`;

const preview = ELECTIONS.previewA;

/**
 * A "not mentioned" cell of the election in preview, resting on the party's own programme: created by the country
 * admin and submitted by editor A, for reviewer A to publish. Returns the cell.
 */
const submittedInPreview = async (client: pg.Client): Promise<string> => {
  await setActor(client, USERS.countryAdminA);
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
     VALUES ($1, $2, $3, $4, 'not_mentioned', '{"es": "Resumen de ejemplo"}') RETURNING id`,
    [TENANT_A, preview.id, preview.party, preview.criterion],
  );
  const cell = rows[0]!.id;
  const source = await asSuperuser(client, async () => {
    const created = await client.query<{ id: string }>(
      `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, url, is_programme)
       VALUES ($1, $2, $3, 'pdf', 'Programa de ejemplo', 'https://example.org/programa-consulta.pdf', true)
       RETURNING id`,
      [TENANT_A, preview.id, preview.party],
    );
    const id = created.rows[0]!.id;
    await client.query(
      `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
      [FILES.sourceA.id, id],
    );
    await client.query(
      `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = $1`,
      [id],
    );
    return id;
  });
  await client.query(
    `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
     VALUES ($1, $2, $3, $4)`,
    [cell, TENANT_A, preview.id, source],
  );
  await setActor(client, USERS.editorA);
  await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [cell]);
  return cell;
};

const PUBLISH = `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
                 SELECT id, content_version FROM app.assessments WHERE id = $1`;

/** The same, published by reviewer A. */
const publishedInPreview = async (client: pg.Client): Promise<string> => {
  const cell = await submittedInPreview(client);
  await setActor(client, USERS.reviewerA);
  await client.query(PUBLISH, [cell]);
  return cell;
};

/**
 * Has editor A draft a change of the cell, with its public note (an update, by default; or a withdrawal), and reviewer
 * A publish it.
 */
const republish = async (
  client: pg.Client,
  cell: string,
  kind: 'update' | 'withdrawal' = 'update',
): Promise<void> => {
  await setActor(client, USERS.editorA);
  await client.query(
    kind === 'withdrawal'
      ? `UPDATE app.assessments
            SET draft_rating = NULL, draft_change_kind = 'withdrawal', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`
      : `UPDATE app.assessments
            SET draft_rating = 'not_mentioned', draft_summary = '{"es": "Resumen de ejemplo revisado"}',
                draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`,
    [cell],
  );
  await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [cell]);
  await setActor(client, USERS.reviewerA);
  await client.query(
    `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
     SELECT id, content_version FROM app.assessments WHERE id = $1`,
    [cell],
  );
};

describe('an election in preview: its status', () => {
  it('comes from a draft, and goes live once, stamping went_live_at then and not before', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const toPreview = await client.query<{ went_live_at: Date | null }>(
        `UPDATE app.elections SET status = 'preview' WHERE id = $1 RETURNING went_live_at`,
        [ELECTIONS.draftA.id],
      );
      expect(toPreview.rows).toEqual([{ went_live_at: null }]);
      const toLive = await client.query<{ now: boolean }>(
        `UPDATE app.elections SET status = 'live' WHERE id = $1 RETURNING went_live_at = now() AS now`,
        [ELECTIONS.draftA.id],
      );
      expect(toLive.rows).toEqual([{ now: true }]);
    });
  });

  it.each([
    ['preview back to draft', preview.id, 'draft'],
    ['preview to archived', preview.id, 'archived'],
    ['live back to preview', ELECTIONS.liveA.id, 'preview'],
    ['archived back to preview', ELECTIONS.archivedA.id, 'preview'],
  ])('never goes from %s', async (_name, id, to) => {
    expect(await actingAs(USERS.countryAdminA, (client) => errorCode(client, status(id, to)))).toBe(
      RESTRICT_VIOLATION,
    );
  });

  it('is entered only by a country admin', async () => {
    expect(
      await actingAs(USERS.editorA, (client) =>
        errorCode(client, status(ELECTIONS.draftA.id, 'preview')),
      ),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('needs what going live needs: here, a methodology', async () => {
    expect(
      await actingAs(USERS.countryAdminA, (client) =>
        errorCode(client, status(ELECTIONS.emptyA.id, 'preview')),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("needs every criterion's short title in the default locale", async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        await client.query(
          `UPDATE app.criteria SET short_title = '{"en": "Example"}' WHERE id = $1`,
          [ELECTIONS.draftA.criterion],
        );
        return errorCode(client, status(ELECTIONS.draftA.id, 'preview'));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('goes live only with every name in the default locale, which an edit in preview may have removed', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        await client.query(
          `UPDATE app.parties SET name = '{"en": "Example Party A"}' WHERE id = $1`,
          [preview.party],
        );
        return errorCode(client, status(preview.id, 'live'));
      }),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('an election in preview: its editing', () => {
  it('takes direct edits, additions and deletions of its structure, with no change request', async () => {
    await actingAs(USERS.editorA, async (client) => {
      expect(
        await errorCode(
          client,
          `UPDATE app.parties SET name = '{"es": "Partido Ejemplo A (renombrado)"}', colour = '#123456',
                                  slug = 'partido-ejemplo-a-renombrado'
            WHERE id = '${preview.party}'`,
        ),
      ).toBeNull();
      expect(
        await errorCode(
          client,
          `UPDATE app.criteria SET title = '{"es": "Criterio de ejemplo (revisado)"}' WHERE id = '${preview.criterion}'`,
        ),
      ).toBeNull();
      expect(
        await errorCode(
          client,
          `INSERT INTO app.parties (tenant_id, election_id, slug, name, short_name, display_order)
           VALUES ('${TENANT_A}', '${preview.id}', 'partido-ejemplo-nuevo', '{"es": "Partido Ejemplo Nuevo"}',
                   '{"es": "PEN"}', 9)`,
        ),
      ).toBeNull();
      expect(
        await errorCode(client, `DELETE FROM app.parties WHERE id = '${preview.secondParty}'`),
      ).toBeNull();
    });
  });

  it('changes its own slug and announcement, which are fixed only once it is live', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      expect(
        await errorCode(
          client,
          `UPDATE app.elections SET slug = 'consulta-de-ejemplo-renombrada', announced = false
            WHERE id = '${preview.id}'`,
        ),
      ).toBeNull();
    });
  });

  it('takes no change request: there is nothing public to change yet', async () => {
    expect(
      await actingAs(USERS.editorA, (client) =>
        errorCode(
          client,
          `INSERT INTO app.change_requests (tenant_id, election_id, action, target_kind, target_id, field,
                                            proposed_value, public_note)
           VALUES ('${TENANT_A}', '${preview.id}', 'update', 'criterion', '${preview.criterion}', 'description',
                   '{"es": "Descripción revisada"}', '{"es": "Nota de ejemplo"}')`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('publishes cells, which the preview role reads and the public does not', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const cell = await publishedInPreview(client);
      const visible = (role: 'aiontheballot_web' | 'aiontheballot_preview') =>
        readingAs(
          client,
          role,
          async () =>
            (
              await client.query<{ n: number }>(
                `SELECT (SELECT count(*) FROM app.assessment_revisions WHERE assessment_id = $1)::int
                      + (SELECT count(*) FROM app.revision_checked_documents c
                           JOIN app.assessment_revisions r ON r.id = c.revision_id
                          WHERE r.assessment_id = $1)::int
                      + (SELECT count(*) FROM app.source_documents s
                          WHERE s.election_id = $2)::int AS n`,
                [cell, preview.id],
              )
            ).rows[0]!.n,
        );
      // Its revision, the document it checked, and that document.
      expect(await visible('aiontheballot_preview')).toBe(3);
      expect(await visible('aiontheballot_web')).toBe(0);
    });
  });
});

describe('an election in preview: going live while a cell is published', () => {
  it('holds the publish until it is decided, so the revision says what the election was when it became public', async () => {
    const [setup, publisher, admin] = [1, 2, 3].map(
      () => new pg.Client({ connectionString: superuserUrl() }),
    ) as [pg.Client, pg.Client, pg.Client];
    await Promise.all([setup.connect(), publisher.connect(), admin.connect()]);
    let cell: string | undefined;
    try {
      // A cell in review, committed: both transactions below write the site's public counter, so neither may have
      // written anything before the race.
      await setup.query('BEGIN');
      await setup.query('SET LOCAL ROLE aiontheballot_admin');
      cell = await submittedInPreview(setup);
      await setup.query('COMMIT');
      for (const client of [publisher, admin]) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE aiontheballot_admin');
      }
      // The country admin's going live, not yet committed; then reviewer A's publish, which waits on it.
      await setActor(admin, USERS.countryAdminA);
      await admin.query(status(preview.id, 'live'));
      await setActor(publisher, USERS.reviewerA);
      const { rows: backend } = await publisher.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      const publishing = publisher.query<{ published_in_preview: boolean }>(
        `${PUBLISH} RETURNING published_in_preview`,
        [cell],
      );
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
      await admin.query('COMMIT');
      // Published once the election is live: never taken for a version from preview.
      expect((await publishing).rows).toEqual([{ published_in_preview: false }]);
    } finally {
      await publisher.query('ROLLBACK').catch(() => undefined);
      await admin.query('ROLLBACK').catch(() => undefined);
      // Everything put back as the fixtures had it, triggers off: the election in preview, and no cell or source.
      await setup.query('BEGIN');
      await setup.query('SET LOCAL session_replication_role = replica');
      await setup.query(
        `UPDATE app.elections SET status = 'preview', went_live_at = NULL WHERE id = $1`,
        [preview.id],
      );
      if (cell) {
        const { rows } = await setup.query<{ id: string }>(
          `SELECT source_document_id AS id FROM app.draft_checked_documents WHERE assessment_id = $1`,
          [cell],
        );
        for (const table of [
          'draft_checked_documents',
          'draft_evidence',
          'review_events',
          'assessment_contributors',
        ]) {
          await setup.query(`DELETE FROM app.${table} WHERE assessment_id = $1`, [cell]);
        }
        await setup.query('DELETE FROM app.assessments WHERE id = $1', [cell]);
        for (const { id } of rows) {
          await setup.query('DELETE FROM app.job_requests WHERE source_document_id = $1', [id]);
          await setup.query('DELETE FROM app.source_documents WHERE id = $1', [id]);
        }
      }
      await setup.query('COMMIT');
      await Promise.all([setup.end(), publisher.end(), admin.end()]);
    }
  }, 20_000);
});

describe('an election in preview: its corrections log', () => {
  it('starts when it goes live: what was republished in preview is no correction', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const cell = await publishedInPreview(client);
      await republish(client, cell);
      await setActor(client, USERS.countryAdminA);
      await client.query(status(preview.id, 'live'));
      const log = () =>
        readingAs(client, 'aiontheballot_web', async () =>
          (
            await client.query<{ change: string }>(
              'SELECT change FROM app.corrections_log WHERE election_id = $1',
              [preview.id],
            )
          ).rows.map((row) => row.change),
        );
      expect(await log()).toEqual([]);
      await republish(client, cell);
      expect(await log()).toEqual(['update']);
    });
  });

  it('starts, for a cell withdrawn in preview, after the first version the public sees of it', async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      const cell = await publishedInPreview(client);
      await republish(client, cell, 'withdrawal');
      await setActor(client, USERS.countryAdminA);
      await client.query(status(preview.id, 'live'));
      const log = () =>
        readingAs(client, 'aiontheballot_web', async () =>
          (
            await client.query<{ change: string }>(
              'SELECT change FROM app.corrections_log WHERE election_id = $1',
              [preview.id],
            )
          ).rows.map((row) => row.change),
        );
      await republish(client, cell);
      expect(await log()).toEqual([]);
      await republish(client, cell);
      expect(await log()).toEqual(['update']);
    });
  });
});

describe('an election in preview: the public', () => {
  it("reads nothing of one that isn't announced, not even its own row, which the preview's role reads", async () => {
    await actingAs(USERS.countryAdminA, async (client) => {
      await client.query('UPDATE app.elections SET announced = false WHERE id = $1', [preview.id]);
      const seen = (role: 'aiontheballot_web' | 'aiontheballot_preview') =>
        readingAs(
          client,
          role,
          async () =>
            (
              await client.query<{ n: number }>(
                'SELECT count(*)::int AS n FROM app.elections WHERE id = $1',
                [preview.id],
              )
            ).rows[0]!.n,
        );
      expect(await seen('aiontheballot_web')).toBe(0);
      expect(await seen('aiontheballot_preview')).toBe(1);
    });
  });
});

describe("an election in preview: the preview's role", () => {
  const asPreview = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
    inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_preview');
      return fn(client);
    });

  it.each([
    [
      'submit a report',
      `SELECT app.submit_report(tenant => '${TENANT_A}', kind => 'error_report', message => 'x')`,
    ],
    [
      'sign up',
      `SELECT app.sign_up(tenant => '${TENANT_A}', email => 'persona@example.org', locale => 'es',
                          future_elections => false, token_hash => 'x')`,
    ],
  ])('may not %s: the preview has no forms', async (_name, sql) => {
    expect(await asPreview((client) => errorCode(client, sql))).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("reads an election in preview, and of a draft only an announced one's own row", async () => {
    const seen = await asPreview(async (client) =>
      (
        await client.query<{ id: string }>(
          'SELECT id FROM app.elections WHERE tenant_id = $1 ORDER BY id',
          [TENANT_A],
        )
      ).rows.map((row) => row.id),
    );
    expect(seen).toEqual(
      [ELECTIONS.liveA.id, ELECTIONS.draftA.id, ELECTIONS.archivedA.id, preview.id].sort(),
    );
  });
});
