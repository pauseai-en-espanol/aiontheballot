import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import {
  CELLS,
  ELECTIONS,
  FILES,
  SOURCES,
  TENANT_A,
  TENANT_INACTIVE,
  USERS,
} from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

const setActor = async (client: pg.Client, userId: string, aal = 2): Promise<void> => {
  await client.query(
    `SELECT set_config('app.user_id', $1, true), set_config('app.aal', $2, true)`,
    [userId, String(aal)],
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

/** Runs `fn` as the superuser, then returns to the admin role. With `replica`, the triggers are off: to corrupt data. */
const asSuperuser = async <T>(
  client: pg.Client,
  fn: () => Promise<T>,
  replica = false,
): Promise<T> => {
  await client.query('RESET ROLE');
  if (replica) {
    await client.query('SET LOCAL session_replication_role = replica');
  }
  const result = await fn();
  if (replica) {
    await client.query('SET LOCAL session_replication_role = origin');
  }
  await client.query('SET LOCAL ROLE aiontheballot_admin');
  return result;
};

/** Runs `fn` as another user, then returns to the current one. */
const asUser = async <T>(client: pg.Client, userId: string, fn: () => Promise<T>): Promise<T> => {
  const { rows } = await client.query<{ actor: string }>(
    `SELECT current_setting('app.user_id') AS actor`,
  );
  await setActor(client, userId);
  const result = await fn();
  await setActor(client, rows[0]!.actor);
  return result;
};

const A = CELLS.A;

const publish = (cell: string, version = 'content_version'): string =>
  `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version)
   SELECT id, ${version} FROM app.assessments WHERE id = '${cell}' RETURNING id`;

const submit = (cell: string): string =>
  `UPDATE app.assessments SET state = 'in_review' WHERE id = '${cell}'`;

/** Publishes A's cell in review as reviewer A, then has editor A draft `set` and submit it again. */
const republished = async (client: pg.Client, set: string): Promise<void> => {
  await asUser(client, USERS.reviewerA, () => client.query(publish(A.review)));
  await asUser(client, USERS.editorA, async () => {
    await client.query(`UPDATE app.assessments SET ${set} WHERE id = $1`, [A.review]);
    await client.query(submit(A.review));
  });
};

const archiveLiveA = (client: pg.Client): Promise<unknown> =>
  asUser(client, USERS.countryAdminA, () =>
    client.query(`UPDATE app.elections SET status = 'archived' WHERE id = $1`, [A.election.id]),
  );

describe('publishing a cell', () => {
  it('copies the reviewed draft, and records privately who contributed and who published', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const { rows } = await client.query<{ id: string }>(publish(A.review));
      const revision = rows[0]!.id;
      expect(
        (
          await client.query(
            `SELECT tenant_id, election_id, party_id, criterion_id, revision_no, change_kind, rating, summary,
                    public_note, published_at = now() AS now
               FROM app.assessment_revisions WHERE id = $1`,
            [revision],
          )
        ).rows,
      ).toEqual([
        {
          tenant_id: TENANT_A,
          election_id: A.election.id,
          party_id: A.election.party,
          criterion_id: A.election.secondCriterion,
          revision_no: 1,
          change_kind: 'initial',
          rating: 'meets',
          summary: { es: 'Resumen de ejemplo' },
          public_note: null,
          now: true,
        },
      ]);
      expect(
        (
          await client.query(
            `SELECT ordinal, quote, location_label, match_status, source_document_id FROM app.revision_evidence
              WHERE revision_id = $1`,
            [revision],
          )
        ).rows,
      ).toEqual([
        {
          ordinal: 1,
          quote: A.quote,
          location_label: 'p. 1',
          match_status: 'matched',
          source_document_id: A.source.id,
        },
      ]);
      expect(
        (
          await client.query(
            `SELECT contributor_ids, reviewer_id, self_reviewed, provenance FROM app.revision_internal
              WHERE revision_id = $1`,
            [revision],
          )
        ).rows,
      ).toEqual([
        {
          contributor_ids: [USERS.editorA],
          reviewer_id: USERS.reviewerA,
          self_reviewed: false,
          provenance: [
            {
              ordinal: 1,
              author: USERS.editorA,
              origin: 'manual',
              llm_suggestion_id: null,
              attested_by: null,
            },
          ],
        },
      ]);
      expect(
        (
          await client.query('SELECT state, generation FROM app.assessments WHERE id = $1', [
            A.review,
          ])
        ).rows,
      ).toEqual([{ state: 'published', generation: 1 }]);
      expect(
        (
          await client.query(
            `SELECT kind, actor_id FROM app.review_events WHERE assessment_id = $1 ORDER BY id DESC LIMIT 1`,
            [A.review],
          )
        ).rows,
      ).toEqual([{ kind: 'approved', actor_id: USERS.reviewerA }]);
    });
  });

  it('labels a quote across a page break with both pages, and copies the checked documents', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await client.query(
        `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
         VALUES ($1, $2, $3, $4, 7, 'sistemas de prueba más avanzados. En la página dos')`,
        [TENANT_A, A.election.id, A.draft, A.source.id],
      );
      await client.query(submit(A.draft));
      await setActor(client, USERS.reviewerA);
      const { rows } = await client.query<{ id: string }>(publish(A.draft));
      expect(
        (
          await client.query(
            `SELECT location_label FROM app.revision_evidence WHERE revision_id = $1 AND ordinal = 7`,
            [rows[0]!.id],
          )
        ).rows,
      ).toEqual([{ location_label: 'p. 1–p. 2' }]);
      expect(
        (
          await client.query(
            `SELECT r.source_document_id, r.checked_at = d.checked_at AS same_time
               FROM app.revision_checked_documents r
               JOIN app.draft_checked_documents d ON d.source_document_id = r.source_document_id
              WHERE r.revision_id = $1 AND d.assessment_id = $2`,
            [rows[0]!.id, A.draft],
          )
        ).rows,
      ).toEqual([{ source_document_id: A.source.id, same_time: true }]);
    });
  });

  it('takes its time from the transaction, whatever the caller sends', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      const { rows } = await asSuperuser(client, () =>
        client.query(
          `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version, published_at, revision_no, rating)
           SELECT id, content_version, '2000-01-01', 7, 'does_not_meet' FROM app.assessments WHERE id = $1
           RETURNING published_at = now() AS now, revision_no, rating`,
          [A.review],
        ),
      );
      expect(rows).toEqual([{ now: true, revision_no: 1, rating: 'meets' }]);
    });
  });

  it.each([
    ['by an editor', USERS.editorA, 2],
    ['by a reviewer of another tenant who is only an editor here', USERS.editorAReviewerB, 2],
    ['at aal1', USERS.reviewerA, 1],
  ])('is refused %s', async (_name, user, aal) => {
    expect(
      await inRolledBackTransaction(async (client) => {
        await client.query('SET LOCAL ROLE aiontheballot_admin');
        await setActor(client, user, aal);
        // Named directly: at aal1 the cell isn't even visible, so the trigger must refuse on its own.
        return errorCode(
          client,
          `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version) VALUES ('${A.review}', 1)`,
        );
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('tells someone who may not publish nothing about the cell, not even that it is not in review', async () => {
    expect(
      await inRolledBackTransaction(async (client) => {
        await client.query('SET LOCAL ROLE aiontheballot_admin');
        await setActor(client, USERS.editorAReviewerB);
        return errorCode(
          client,
          `INSERT INTO app.assessment_revisions (assessment_id, reviewed_version) VALUES ('${A.draft}', 1)`,
        );
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it('is refused to someone who edited the draft, while the election requires a second reviewer', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
        await asUser(client, USERS.countryAdminA, () =>
          client.query(
            `UPDATE app.assessments SET draft_summary = '{"es": "Resumen corregido"}' WHERE id = $1`,
            [A.review],
          ),
        );
        await client.query(submit(A.review));
        await setActor(client, USERS.countryAdminA);
        return errorCode(client, publish(A.review));
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  /** A source of A's live election, stored from a file `uploader` uploads; with text unless `scanned`. */
  const uploadedSource = (client: pg.Client, uploader: string, scanned = false) =>
    asSuperuser(client, async () => {
      const { rows: actor } = await client.query<{ id: string }>(
        `SELECT current_setting('app.user_id') AS id`,
      );
      await setActor(client, uploader);
      const { rows: files } = await client.query<{ id: string }>(
        `INSERT INTO app.files (tenant_id, bucket, content_type, byte_size, sha256)
         VALUES ($1, 'sources', 'application/pdf', 3, encode(sha256(convert_to($2, 'UTF8')), 'hex')) RETURNING id`,
        [TENANT_A, uploader.slice(-3)],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
         VALUES ($1, $2, $3, 'pdf', 'Documento subido') RETURNING id`,
        [TENANT_A, A.election.id, A.election.party],
      );
      await client.query(
        `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
        [files[0]!.id, rows[0]!.id],
      );
      if (!scanned) {
        await client.query(
          `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
           VALUES ($1, $2, 1, 'p. 1', 'Una frase subida por otra persona de ejemplo.')`,
          [rows[0]!.id, TENANT_A],
        );
      }
      await client.query(`UPDATE app.source_documents SET extraction_status = $1 WHERE id = $2`, [
        scanned ? 'not_applicable' : 'done',
        rows[0]!.id,
      ]);
      await setActor(client, actor[0]!.id);
      return { source: rows[0]!.id, file: files[0]!.id };
    });

  /** Editor A cites in A's recalled cell a file country admin A uploaded, the way `cite` says. */
  const CITES: readonly [string, (client: pg.Client) => Promise<unknown>][] = [
    [
      'quotes',
      async (client) => {
        const { source } = await uploadedSource(client, USERS.countryAdminA);
        await client.query(
          `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
           VALUES ($1, $2, $3, $4, 2, 'Una frase subida por otra persona')`,
          [TENANT_A, A.election.id, A.review, source],
        );
      },
    ],
    [
      'checks',
      async (client) => {
        const { source } = await uploadedSource(client, USERS.countryAdminA);
        await client.query(
          `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
           VALUES ($1, $2, $3, $4)`,
          [A.review, TENANT_A, A.election.id, source],
        );
      },
    ],
    [
      'attests a quote with',
      async (client) => {
        const { file } = await uploadedSource(client, USERS.countryAdminA);
        const { source } = await uploadedSource(client, USERS.editorA, true);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                           attestation_file_id)
           VALUES ($1, $2, $3, $4, 2, 'Una frase escaneada de ejemplo', $5) RETURNING id`,
          [TENANT_A, A.election.id, A.review, source, file],
        );
        await asUser(client, USERS.reviewerA, () =>
          client.query('UPDATE app.draft_evidence SET attested_by = $1 WHERE id = $2', [
            USERS.reviewerA,
            rows[0]!.id,
          ]),
        );
      },
    ],
  ];

  it.each(CITES)('is refused to someone who uploaded a file the draft %s', async (_name, cite) => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
        await cite(client);
        await client.query(submit(A.review));
        await setActor(client, USERS.countryAdminA);
        return errorCode(client, publish(A.review));
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it.each([
    [
      'a stale version',
      (c: pg.Client) => c.query('SELECT 1'),
      publish(A.review, 'content_version - 1'),
    ],
    ['a cell that is not in review', (c: pg.Client) => c.query('SELECT 1'), publish(A.draft)],
    [
      'inside the freeze window',
      (c: pg.Client) =>
        asUser(c, USERS.countryAdminA, () =>
          c.query(`UPDATE app.elections SET frozen_from = now() WHERE id = $1`, [A.election.id]),
        ),
      publish(A.review),
    ],
  ])('is refused for %s', async (_name, prepare, sql) => {
    expect(
      await actingAs(USERS.reviewerA, async (client) => {
        await prepare(client);
        return errorCode(client, sql);
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('goes ahead once the freeze window is over', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await asUser(client, USERS.countryAdminA, () =>
        client.query(
          `UPDATE app.elections SET frozen_from = now() - interval '2 days', frozen_until = now() - interval '1 day'
            WHERE id = $1`,
          [A.election.id],
        ),
      );
      expect(await errorCode(client, publish(A.review))).toBeNull();
    });
  });

  it('is refused in a draft election', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const draftA = ELECTIONS.draftA;
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
           VALUES ($1, $2, $3, $4, 'not_mentioned', '{"es": "Resumen"}') RETURNING id`,
          [TENANT_A, draftA.id, draftA.party, draftA.criterion],
        );
        // The draft election's own programme, stored and with no text to extract.
        await asSuperuser(client, async () => {
          await client.query(
            `UPDATE app.source_documents SET party_id = $1, file_id = $2, file_origin = 'uploaded' WHERE id = $3`,
            [draftA.party, FILES.sourceA.id, SOURCES.draftA.id],
          );
          await client.query(
            `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = $1`,
            [SOURCES.draftA.id],
          );
        });
        await client.query(
          `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
           VALUES ($1, $2, $3, $4)`,
          [rows[0]!.id, TENANT_A, draftA.id, SOURCES.draftA.id],
        );
        await asUser(client, USERS.editorA, () => client.query(submit(rows[0]!.id)));
        await setActor(client, USERS.reviewerA);
        return errorCode(client, publish(rows[0]!.id));
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it('is refused for an update once the election is archived', async () => {
    expect(
      await actingAs(USERS.reviewerA, async (client) => {
        await republished(
          client,
          `draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'`,
        );
        await archiveLiveA(client);
        return errorCode(client, publish(A.review));
      }),
    ).toBe(RESTRICT_VIOLATION);
  });

  it.each([
    [
      'with a quote that no longer matches',
      `UPDATE app.draft_evidence SET quote = 'una frase que no aparece en el programa', match_status = 'matched'
        WHERE id = '${A.evidence}'`,
    ],
    ['without a quote', `DELETE FROM app.draft_evidence WHERE id = '${A.evidence}'`],
    [
      'with a rating off the scale',
      `UPDATE app.assessments SET draft_rating = 'green' WHERE id = '${A.review}'`,
    ],
    [
      'with a summary not in the default locale',
      `UPDATE app.assessments SET draft_summary = '{"en": "Example"}' WHERE id = '${A.review}'`,
    ],
    [
      'with a change kind before its first publish',
      `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota"}'
        WHERE id = '${A.review}'`,
    ],
    [
      'from a kind the methodology no longer admits',
      `UPDATE app.methodologies SET admissible_source_kinds = '{web_page}' WHERE id = '${A.election.methodology}'`,
    ],
  ])('is refused %s, even if the draft got past the earlier checks', async (_name, corrupt) => {
    expect(
      await actingAs(USERS.reviewerA, async (client) => {
        await asSuperuser(client, () => client.query(corrupt), true);
        return errorCode(client, publish(A.review));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('is refused for "not mentioned" without a checked document of the party\'s own', async () => {
    expect(
      await actingAs(USERS.reviewerA, async (client) => {
        await asSuperuser(
          client,
          async () => {
            await client.query('DELETE FROM app.draft_checked_documents WHERE assessment_id = $1', [
              A.draft,
            ]);
            await client.query(`UPDATE app.assessments SET state = 'in_review' WHERE id = $1`, [
              A.draft,
            ]);
          },
          true,
        );
        return errorCode(client, publish(A.draft));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it.each([
    ['as "initial" after the first', `draft_change_kind = 'initial'`],
    ['without a public note in the default locale', `draft_public_note = '{"en": "Example note"}'`],
    ['as a withdrawal with a rating', `draft_change_kind = 'withdrawal'`],
  ])('is refused %s', async (_name, set) => {
    expect(
      await actingAs(USERS.reviewerA, async (client) => {
        await republished(
          client,
          `draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'`,
        );
        await asSuperuser(
          client,
          () => client.query(`UPDATE app.assessments SET ${set} WHERE id = $1`, [A.review]),
          true,
        );
        return errorCode(client, publish(A.review));
      }),
    ).toBe(CHECK_VIOLATION);
  });
});

describe('publishing goes ahead', () => {
  it('with an attested quote, labelled with its section and recorded with its attester', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      const { source, file } = await asSuperuser(client, async () => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
           VALUES ($1, $2, $3, 'pdf', 'Programa escaneado') RETURNING id`,
          [TENANT_A, A.election.id, A.election.party],
        );
        await client.query(
          `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
          [FILES.sourceA.id, rows[0]!.id],
        );
        await client.query(
          `UPDATE app.source_documents SET extraction_status = 'not_applicable' WHERE id = $1`,
          [rows[0]!.id],
        );
        return { source: rows[0]!.id, file: FILES.sourceA.id };
      });
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                         section_label, attestation_file_id)
         VALUES ($1, $2, $3, $4, 2, 'Una frase escaneada de ejemplo', 'Sección 2', $5) RETURNING id`,
        [TENANT_A, A.election.id, A.review, source, file],
      );
      await asUser(client, USERS.reviewerA, () =>
        client.query('UPDATE app.draft_evidence SET attested_by = $1 WHERE id = $2', [
          USERS.reviewerA,
          rows[0]!.id,
        ]),
      );
      await client.query(submit(A.review));
      await setActor(client, USERS.countryAdminA);
      const { rows: published } = await client.query<{ id: string }>(publish(A.review));
      expect(
        (
          await client.query(
            `SELECT e.location_label, e.match_status, i.provenance -> 1 ->> 'attested_by' AS attester
               FROM app.revision_evidence e JOIN app.revision_internal i ON i.revision_id = e.revision_id
              WHERE e.revision_id = $1 AND e.ordinal = 2`,
            [published[0]!.id],
          )
        ).rows,
      ).toEqual([
        { location_label: 'Sección 2', match_status: 'attested', attester: USERS.reviewerA },
      ]);
    });
  });

  it('for a reviewer who rejected the cell, once it is fixed', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await client.query(
        `INSERT INTO app.review_events (tenant_id, assessment_id, kind, note) VALUES ($1, $2, 'commented', 'Falta contexto')`,
        [TENANT_A, A.review],
      );
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      await asUser(client, USERS.editorA, async () => {
        await client.query(
          `UPDATE app.assessments SET draft_summary = '{"es": "Resumen con contexto"}' WHERE id = $1`,
          [A.review],
        );
        await client.query(submit(A.review));
      });
      expect(await errorCode(client, publish(A.review))).toBeNull();
    });
  });

  it('for someone who contributed only to an earlier generation', async () => {
    await actingAs(USERS.editorA, async (client) => {
      // Country admin A edits generation 0; reviewer A publishes it; editor A edits generation 1.
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      await asUser(client, USERS.countryAdminA, () =>
        client.query(
          `UPDATE app.assessments SET draft_summary = '{"es": "Resumen anterior"}' WHERE id = $1`,
          [A.review],
        ),
      );
      await client.query(submit(A.review));
      await asUser(client, USERS.reviewerA, () => client.query(publish(A.review)));
      await client.query(
        `UPDATE app.assessments SET draft_change_kind = 'update', draft_public_note = '{"es": "Nota de ejemplo"}'
          WHERE id = $1`,
        [A.review],
      );
      await client.query(submit(A.review));
      await setActor(client, USERS.countryAdminA);
      expect(await errorCode(client, publish(A.review))).toBeNull();
    });
  });

  it('for its own contributor once a platform admin turns off the second reviewer, recorded privately', async () => {
    await actingAs(USERS.editorA, async (client) => {
      await asUser(client, USERS.platformAdmin, () =>
        client.query('UPDATE app.elections SET require_second_reviewer = false WHERE id = $1', [
          A.election.id,
        ]),
      );
      await client.query(`UPDATE app.assessments SET state = 'draft' WHERE id = $1`, [A.review]);
      await asUser(client, USERS.countryAdminA, () =>
        client.query(
          `UPDATE app.assessments SET draft_summary = '{"es": "Resumen propio"}' WHERE id = $1`,
          [A.review],
        ),
      );
      await client.query(submit(A.review));
      await setActor(client, USERS.countryAdminA);
      const { rows } = await client.query<{ id: string }>(publish(A.review));
      expect(
        (
          await client.query(
            'SELECT self_reviewed FROM app.revision_internal WHERE revision_id = $1',
            [rows[0]!.id],
          )
        ).rows,
      ).toEqual([{ self_reviewed: true }]);
    });
  });

  it('for a correction once the election is archived, numbered and noted', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await republished(
        client,
        `draft_change_kind = 'correction', draft_public_note = '{"es": "Nota de ejemplo"}'`,
      );
      await archiveLiveA(client);
      const { rows } = await client.query<{ id: string }>(publish(A.review));
      expect(
        (
          await client.query(
            'SELECT revision_no, change_kind, public_note FROM app.assessment_revisions WHERE id = $1',
            [rows[0]!.id],
          )
        ).rows,
      ).toEqual([
        { revision_no: 2, change_kind: 'correction', public_note: { es: 'Nota de ejemplo' } },
      ]);
    });
  });

  it('for a withdrawal, which leaves the cell with no current rating', async () => {
    await actingAs(USERS.reviewerA, async (client) => {
      await republished(
        client,
        `draft_rating = NULL, draft_change_kind = 'withdrawal', draft_public_note = '{"es": "Nota de ejemplo"}'`,
      );
      await client.query(publish(A.review));
      expect(
        (
          await client.query(
            'SELECT revision_no, change_kind, rating FROM app.current_revisions WHERE assessment_id = $1',
            [A.review],
          )
        ).rows,
      ).toEqual([{ revision_no: 2, change_kind: 'withdrawal', rating: null }]);
    });
  });
});

describe('the public', () => {
  const asPublic = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
    inRolledBackTransaction(async (client) => {
      await client.query('SET LOCAL ROLE aiontheballot_web');
      return fn(client);
    });

  it('reads revisions of live and archived elections of active tenants only', async () => {
    const tenants = await asPublic(async (client) =>
      (
        await client.query<{ tenant_id: string }>(
          'SELECT DISTINCT tenant_id FROM app.assessment_revisions',
        )
      ).rows.map((r) => r.tenant_id),
    );
    expect(tenants).toContain(TENANT_A);
    expect(tenants).not.toContain(TENANT_INACTIVE);
  });

  it('reads the sources a public revision cites, and no other', async () => {
    const titles = await asPublic(async (client) =>
      (
        await client.query<{ id: string }>(
          'SELECT id FROM app.source_documents WHERE id = ANY ($1)',
          [[SOURCES.neutralA.id, SOURCES.liveA.id]],
        )
      ).rows.map((r) => r.id),
    );
    expect(titles).toEqual([SOURCES.neutralA.id]);
  });
});
