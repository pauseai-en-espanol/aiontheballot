import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { CELLS, ELECTIONS, FILES, SOURCES, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';
const INSUFFICIENT_PRIVILEGE = '42501';

const asEditorA = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [USERS.editorA],
    );
    return fn(client);
  });

const asOwner = <T>(fn: (client: pg.Client) => Promise<T>): Promise<T> =>
  inRolledBackTransaction(async (client) => {
    await client.query('SET LOCAL ROLE aiontheballot_owner');
    return fn(client);
  });

const attach = (file: string, source = SOURCES.draftA.id): string =>
  `UPDATE app.source_documents SET file_id = '${file}', file_origin = 'uploaded' WHERE id = '${source}'`;

describe('a source document', () => {
  it('takes the hash from the stored copy and the time from the transaction when the copy is attached', async () => {
    const [row] = await asEditorA(async (client) => {
      await client.query(attach(FILES.awaitingA.id));
      return (
        await client.query(
          `SELECT s.sha256 = f.sha256 AS hash, s.retrieved_at = now() AS now
             FROM app.source_documents s JOIN app.files f ON f.id = s.file_id WHERE s.id = $1`,
          [SOURCES.draftA.id],
        )
      ).rows;
    });
    expect(row).toEqual({ hash: true, now: true });
  });

  it('keeps its copy, and everything about it, once stored in an election the public sees', async () => {
    await asEditorA(async (client) => {
      const live = SOURCES.liveA.id;
      for (const sql of [
        attach(FILES.awaitingA.id, live),
        `UPDATE app.source_documents SET title = 'Otro título' WHERE id = '${live}'`,
        `UPDATE app.source_documents SET party_id = NULL WHERE id = '${live}'`,
      ]) {
        expect(await errorCode(client, sql)).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("is stored as fetched only by a fetch job: anyone else's copy is an upload, which four-eyes counts", async () => {
    // An editor who uploads a document and calls it fetched would not count as its uploader, and could publish a
    // cell quoting it (private.revision_contributors).
    await asEditorA(async (client) => {
      expect(
        await errorCode(client, attach(FILES.awaitingA.id).replace("'uploaded'", "'fetched'")),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(
        await errorCode(
          client,
          `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title, file_id, file_origin)
           SELECT tenant_id, election_id, party_id, kind, 'Otra copia de ejemplo', '${FILES.awaitingA.id}', 'fetched'
             FROM app.source_documents WHERE id = '${SOURCES.draftA.id}'`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await errorCode(client, attach(FILES.awaitingA.id))).toBeNull();
    });
  });

  it('stores its copy only from the sources bucket of its own tenant', async () => {
    expect(await asEditorA((c) => errorCode(c, attach(FILES.logoA.id)))).toBe(CHECK_VIOLATION);
    expect(await inRolledBackTransaction((c) => errorCode(c, attach(FILES.sourceB.id)))).toBe(
      FOREIGN_KEY_VIOLATION,
    );
  });

  it("belongs to a party of its own election, and only a party's document is its programme", async () => {
    expect(
      await asEditorA((c) =>
        errorCode(
          c,
          `UPDATE app.source_documents SET party_id = '${ELECTIONS.liveA.party}' WHERE id = '${SOURCES.draftA.id}'`,
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
    expect(
      await asEditorA((c) =>
        errorCode(
          c,
          `UPDATE app.source_documents SET is_programme = true WHERE id = '${SOURCES.draftA.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('can be added to an archived election, for corrections', async () => {
    expect(
      await asEditorA((c) =>
        errorCode(
          c,
          `INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
           VALUES ('${TENANT_A}', '${ELECTIONS.archivedA.id}', 'web_page', 'Página de ejemplo')`,
        ),
      ),
    ).toBeNull();
  });
});

describe('a stored source nothing rests on, in an election not yet public (PLAN R226)', () => {
  // SOURCES.pendingA: in a draft election, its copy stored, cited by nothing.
  const pending = SOURCES.pendingA.id;
  const set = (assignments: string, id = pending): string =>
    `UPDATE app.source_documents SET ${assignments} WHERE id = '${id}'`;

  /** A new source of `election`, its copy stored, for the editor of tenant A; its id. */
  const storedIn = async (client: pg.Client, election: string): Promise<string> => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
       VALUES ($1, $2, 'pdf', 'Documento de ejemplo') RETURNING id`,
      [TENANT_A, election],
    );
    const id = rows[0]?.id ?? '';
    await client.query(attach(FILES.awaitingA.id, id));
    return id;
  };

  it('can still have its title, language, party and programme mark corrected', async () => {
    const [row] = await asEditorA(async (client) => {
      await client.query(
        set(
          `title = 'Programa de ejemplo', language = 'es', party_id = '${ELECTIONS.draftA.party}', is_programme = true`,
        ),
      );
      return (
        await client.query(
          `SELECT title, language, party_id, is_programme, file_id FROM app.source_documents WHERE id = $1`,
          [pending],
        )
      ).rows;
    });
    expect(row).toEqual({
      title: 'Programa de ejemplo',
      language: 'es',
      party_id: ELECTIONS.draftA.party,
      is_programme: true,
      file_id: FILES.awaitingA.id,
    });
  });

  it('also in preview, which only members see', async () => {
    await asEditorA(async (client) => {
      const id = await storedIn(client, ELECTIONS.previewA.id);
      expect(await errorCode(client, set(`title = 'Otro título'`, id))).toBeNull();
    });
  });

  it('never has its kind, address or copy changed', async () => {
    await asEditorA(async (client) => {
      for (const assignments of [
        `kind = 'web_page'`,
        `url = 'https://example.org/otro'`,
        `file_id = NULL, file_origin = NULL`,
        `title = 'Otro título', kind = 'web_page'`,
      ]) {
        expect(await errorCode(client, set(assignments))).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it('is fixed for good once its election is public', async () => {
    await asEditorA(async (client) => {
      const id = await storedIn(client, ELECTIONS.liveA.id);
      expect(await errorCode(client, set(`title = 'Otro título'`, id))).toBe(RESTRICT_VIOLATION);
    });
  });

  it('is fixed for good once a quote, a "not mentioned" check or a suggestion run rests on it', async () => {
    // Each written past the triggers, as no cell of this draft election could cite the source yet.
    const citing = [
      `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                       created_by)
       VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', '${CELLS.A.draft}', '${pending}', 9, 'Cita de ejemplo',
               '${USERS.editorA}')`,
      `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id, checked_by)
       VALUES ('${CELLS.A.review}', '${TENANT_A}', '${ELECTIONS.draftA.id}', '${pending}', '${USERS.editorA}')`,
      `INSERT INTO app.revision_evidence (revision_id, tenant_id, election_id, ordinal, source_document_id, quote,
                                          match_status)
       VALUES ('${CELLS.A.published}', '${TENANT_A}', '${ELECTIONS.draftA.id}', 9, '${pending}', 'Cita de ejemplo',
               'matched')`,
      `INSERT INTO app.revision_checked_documents (revision_id, tenant_id, election_id, source_document_id, checked_at)
       VALUES ('${CELLS.A.published}', '${TENANT_A}', '${ELECTIONS.draftA.id}', '${pending}', now())`,
      `INSERT INTO app.llm_runs (tenant_id, election_id, source_document_id, model, prompt_version, requested_by)
       VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', '${pending}', 'modelo-de-ejemplo', 'v1', '${USERS.editorA}')`,
    ];
    for (const sql of citing) {
      expect(
        await inRolledBackTransaction(async (client) => {
          await client.query('SET LOCAL session_replication_role = replica');
          await client.query(sql);
          await client.query('SET LOCAL session_replication_role = origin');
          await client.query('SET LOCAL ROLE aiontheballot_admin');
          await client.query(
            `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
            [USERS.editorA],
          );
          return errorCode(client, set(`title = 'Otro título'`));
        }),
      ).toBe(RESTRICT_VIOLATION);
    }
  });

  it("keeps a published programme's party with a source marked as its programme", async () => {
    const party = ELECTIONS.draftA.party;
    await asEditorA(async (client) => {
      await client.query(set(`party_id = '${party}', is_programme = true`));
      await client.query(`UPDATE app.parties SET programme_status = 'published' WHERE id = $1`, [
        party,
      ]);
      for (const assignments of [
        'is_programme = false',
        `party_id = '${ELECTIONS.draftA.secondParty}'`,
      ]) {
        expect(await errorCode(client, set(assignments))).toBe(CHECK_VIOLATION);
      }
      // Another of its sources marked as its programme first, and this one may go.
      const other = await storedIn(client, ELECTIONS.draftA.id);
      await client.query(set(`party_id = '${party}', is_programme = true`, other));
      expect(await errorCode(client, set('is_programme = false'))).toBeNull();
    });
  });
});

describe('deleting a source, with its text, jobs and file (private.delete_source; PLAN R228)', () => {
  const remove = (election: string, source: string) =>
    `SELECT private.delete_source('${TENANT_A}', '${election}', '${source}') AS deleted`;
  const as = async (client: pg.Client, user: string): Promise<void> => {
    await client.query('SET LOCAL ROLE aiontheballot_admin');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.aal', '2', true)`,
      [user],
    );
  };
  /** What is left of a source, read as the superuser. */
  const left = async (client: pg.Client, source: string, file: string) =>
    (
      await client.query<{ sources: number; texts: number; jobs: number; files: number }>(
        `SELECT (SELECT count(*)::int FROM app.source_documents WHERE id = $1) AS sources,
                (SELECT count(*)::int FROM app.source_texts WHERE source_document_id = $1) AS texts,
                (SELECT count(*)::int FROM app.job_requests WHERE source_document_id = $1) AS jobs,
                (SELECT count(*)::int FROM app.files WHERE id = $2) AS files`,
        [source, file],
      )
    ).rows[0];
  const pending = SOURCES.pendingA.id;
  const draft = ELECTIONS.draftA.id;
  /** A page of a source's text, written past the triggers, as extraction would have. */
  const page = (source: string): string =>
    `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
     VALUES ('${source}', '${TENANT_A}', 1, 'p. 1', 'Texto de ejemplo extraído')`;
  /** Each kind of row that rests on the pending source, written past the triggers. */
  const citing = [
    `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                     created_by)
     VALUES ('${TENANT_A}', '${draft}', '${CELLS.A.draft}', '${pending}', 9, 'Cita de ejemplo', '${USERS.editorA}')`,
    `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id, checked_by)
     VALUES ('${CELLS.A.review}', '${TENANT_A}', '${draft}', '${pending}', '${USERS.editorA}')`,
    `INSERT INTO app.revision_evidence (revision_id, tenant_id, election_id, ordinal, source_document_id, quote,
                                        match_status)
     VALUES ('${CELLS.A.published}', '${TENANT_A}', '${draft}', 9, '${pending}', 'Cita de ejemplo', 'matched')`,
    `INSERT INTO app.revision_checked_documents (revision_id, tenant_id, election_id, source_document_id, checked_at)
     VALUES ('${CELLS.A.published}', '${TENANT_A}', '${draft}', '${pending}', now())`,
    `INSERT INTO app.llm_runs (tenant_id, election_id, source_document_id, model, prompt_version, requested_by)
     VALUES ('${TENANT_A}', '${draft}', '${pending}', 'modelo-de-ejemplo', 'v1', '${USERS.editorA}')`,
  ];

  it('deletes a stored source nothing rests on, in an election not yet public, with its jobs and file', async () => {
    await inRolledBackTransaction(async (client) => {
      // Its text too: a page given past the triggers, as extraction would have.
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(
        `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES ($1, $2, 1, 'p. 1', 'Texto de ejemplo extraído')`,
        [pending, TENANT_A],
      );
      await client.query('SET LOCAL session_replication_role = origin');
      await as(client, USERS.editorA);
      expect((await client.query(remove(draft, pending))).rows).toEqual([{ deleted: true }]);
      await client.query('RESET ROLE');
      expect(await left(client, pending, FILES.awaitingA.id)).toEqual({
        sources: 0,
        texts: 0,
        jobs: 0,
        files: 0,
      });
      // In the audit, as the editor's.
      const { rows } = await client.query(
        `SELECT actor_id FROM app.audit_log WHERE table_name = 'source_documents' AND row_id = $1
            AND diff -> 'new' IS NULL ORDER BY id DESC LIMIT 1`,
        [pending],
      );
      expect(rows).toEqual([{ actor_id: USERS.editorA }]);
      // Its flag cleared: nothing later in the transaction gets past the text's guard with it.
      const { rows: flag } = await client.query(
        `SELECT current_setting('app.delete_source', true) AS flag`,
      );
      expect(flag).toEqual([{ flag: '' }]);
    });
  });

  it('keeps the file while another source names it', async () => {
    await asEditorA(async (client) => {
      await client.query(attach(FILES.awaitingA.id, SOURCES.draftA.id));
      await client.query(remove(draft, pending));
      await client.query('RESET ROLE');
      expect((await left(client, pending, FILES.awaitingA.id))?.files).toBe(1);
    });
  });

  it('deletes a source with no copy, in any election, its jobs with it', async () => {
    await asEditorA(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
         VALUES ($1, $2, 'web_page', 'Página de ejemplo') RETURNING id`,
        [TENANT_A, ELECTIONS.liveA.id],
      );
      const fresh = rows[0]?.id ?? '';
      expect((await client.query(remove(ELECTIONS.liveA.id, fresh))).rows).toEqual([
        { deleted: true },
      ]);
      // The draft's own: an open fetch job and a finished one.
      expect((await client.query(remove(draft, SOURCES.draftA.id))).rows).toEqual([
        { deleted: true },
      ]);
      await client.query('RESET ROLE');
      expect((await left(client, SOURCES.draftA.id, FILES.awaitingA.id))?.jobs).toBe(0);
    });
  });

  it('answers false for a source not in that election', async () => {
    expect(
      await asEditorA(
        async (client) => (await client.query(remove(ELECTIONS.liveA.id, pending))).rows,
      ),
    ).toEqual([{ deleted: false }]);
  });

  it('refuses a stored source once its election is public', async () => {
    await asEditorA(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.source_documents (tenant_id, election_id, kind, title)
         VALUES ($1, $2, 'pdf', 'Documento de ejemplo') RETURNING id`,
        [TENANT_A, ELECTIONS.liveA.id],
      );
      const stored = rows[0]?.id ?? '';
      await client.query(attach(FILES.awaitingA.id, stored));
      expect(await errorCode(client, remove(ELECTIONS.liveA.id, stored))).toBe(RESTRICT_VIOLATION);
    });
  });

  it('refuses a source a quote, a "not mentioned" check or a suggestion run rests on', async () => {
    // With a page of text, so the refusal is the function's own, before the text's guard and the foreign keys.
    for (const sql of citing) {
      expect(
        await inRolledBackTransaction(async (client) => {
          await client.query('SET LOCAL session_replication_role = replica');
          await client.query(sql);
          await client.query(page(pending));
          await client.query('SET LOCAL session_replication_role = origin');
          await as(client, USERS.editorA);
          return errorCode(client, remove(draft, pending));
        }),
      ).toBe(FOREIGN_KEY_VIOLATION);
    }
  });

  it("refuses those who don't write the site's sources, and members' tokens", async () => {
    for (const user of [USERS.reviewerA, USERS.countryAdminB, USERS.noMembership]) {
      expect(
        await inRolledBackTransaction(async (client) => {
          await as(client, user);
          return errorCode(client, remove(draft, pending));
        }),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect(
      await asEditorA(async (client) => {
        await client.query(`SELECT set_config('app.token_id', gen_random_uuid()::text, true)`);
        return errorCode(client, remove(draft, pending));
      }),
    ).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses a published programme's only source", async () => {
    await asEditorA(async (client) => {
      await client.query(
        `UPDATE app.source_documents SET party_id = $1, is_programme = true WHERE id = $2`,
        [ELECTIONS.draftA.party, pending],
      );
      await client.query(`UPDATE app.parties SET programme_status = 'published' WHERE id = $1`, [
        ELECTIONS.draftA.party,
      ]);
      expect(await errorCode(client, remove(draft, pending))).toBe(CHECK_VIOLATION);
    });
  });

  it("lets no flag alone through the text's guard, nor the owner's rights alone", async () => {
    /** Deletes the text of the source `setUp` names, with the owner's rights, with or without the flag naming it. */
    const guarded = async (
      flagged: boolean,
      setUp: (client: pg.Client) => Promise<string>,
    ): Promise<string | null> =>
      inRolledBackTransaction(async (client) => {
        await client.query('SET LOCAL session_replication_role = replica');
        const source = await setUp(client);
        await client.query('SET LOCAL session_replication_role = origin');
        await client.query('SET LOCAL ROLE aiontheballot_owner');
        if (flagged) {
          await client.query(`SELECT set_config('app.delete_source', $1, true)`, [source]);
        }
        return errorCode(
          client,
          `DELETE FROM app.source_texts WHERE source_document_id = '${source}'`,
        );
      });
    // The flag and the owner's rights, on a source that may go: through, as delete_source does it.
    expect(
      await guarded(true, async (client) => {
        await client.query(page(pending));
        return pending;
      }),
    ).toBeNull();
    // The owner's rights without the flag: the same source keeps its text.
    expect(
      await guarded(false, async (client) => {
        await client.query(page(pending));
        return pending;
      }),
    ).toBe(RESTRICT_VIOLATION);
    // The flag and the owner's rights, but something rests on the source.
    for (const sql of citing) {
      expect(
        await guarded(true, async (client) => {
          await client.query(page(pending));
          await client.query(sql);
          return pending;
        }),
      ).toBe(RESTRICT_VIOLATION);
    }
    // The flag and the owner's rights, but the source is stored in a public election.
    expect(
      await guarded(true, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO app.source_documents (tenant_id, election_id, kind, title, file_id, file_origin, sha256,
                                             retrieved_at, created_by)
           SELECT tenant_id, '${ELECTIONS.liveA.id}', 'pdf', 'Documento de ejemplo', id, 'uploaded', sha256, now(),
                  '${USERS.editorA}'
             FROM app.files WHERE id = '${FILES.awaitingA.id}' RETURNING id`,
        );
        const stored = rows[0]?.id ?? '';
        await client.query(page(stored));
        return stored;
      }),
    ).toBe(RESTRICT_VIOLATION);
    // The flag names a source a quote rests on: its text stays, whoever deletes it.
    await asOwner(async (client) => {
      await client.query(`SELECT set_config('app.delete_source', $1, true)`, [SOURCES.liveA.id]);
      expect(
        await errorCode(
          client,
          `DELETE FROM app.source_texts WHERE source_document_id = '${SOURCES.liveA.id}'`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
    // The runtime role can't delete text at all, flag or not.
    await asEditorA(async (client) => {
      await client.query(`SELECT set_config('app.delete_source', $1, true)`, [pending]);
      expect(
        await errorCode(
          client,
          `DELETE FROM app.source_texts WHERE source_document_id = '${pending}'`,
        ),
      ).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('the extraction status and the archive', () => {
  it('move one way: the status leaves pending once, and the archive is set once', async () => {
    await asOwner(async (client) => {
      const live = `id = '${SOURCES.liveA.id}'`;
      expect(
        await errorCode(
          client,
          `UPDATE app.source_documents SET extraction_status = 'pending' WHERE ${live}`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      expect(
        await errorCode(
          client,
          `UPDATE app.source_documents SET extraction_status = 'failed' WHERE ${live}`,
        ),
      ).toBe(RESTRICT_VIOLATION);
      await client.query(
        `UPDATE app.source_documents SET archive_url = 'https://archive.example.org/a' WHERE ${live}`,
      );
      expect(
        await errorCode(
          client,
          `UPDATE app.source_documents SET archive_url = 'https://archive.example.org/b' WHERE ${live}`,
        ),
      ).toBe(RESTRICT_VIOLATION);
    });
  });

  it('is done only for a source with a stored copy', async () => {
    expect(
      await asOwner((c) =>
        errorCode(
          c,
          `UPDATE app.source_documents SET extraction_status = 'done' WHERE id = '${SOURCES.draftA.id}'`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it('starts pending, with no archive', async () => {
    expect(
      await asOwner((c) =>
        errorCode(
          c,
          `INSERT INTO app.source_documents (tenant_id, election_id, kind, title, extraction_status)
           VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', 'pdf', 'x', 'done')`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });
});

describe('a replaced source (PLAN D14)', () => {
  const replaced = (client: pg.Client, id: string) =>
    client
      .query<{ now: boolean }>(
        'SELECT replaced_at = now() AS now FROM app.source_documents WHERE id = $1',
        [id],
      )
      .then(({ rows }) => rows[0]?.now ?? null);

  it("is marked once, at the transaction's time, also once its copy is stored", async () => {
    await asEditorA(async (client) => {
      const live = SOURCES.liveA.id;
      await client.query(
        `UPDATE app.source_documents SET replaced_at = '2000-01-01' WHERE id = $1`,
        [live],
      );
      expect(await replaced(client, live)).toBe(true);
      for (const sql of [
        `UPDATE app.source_documents SET replaced_at = NULL WHERE id = '${live}'`,
        `UPDATE app.source_documents SET replaced_at = '2001-01-01' WHERE id = '${live}'`,
      ]) {
        expect(await errorCode(client, sql)).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it('is never new', async () => {
    expect(
      await asOwner((c) =>
        errorCode(
          c,
          `INSERT INTO app.source_documents (tenant_id, election_id, kind, title, replaced_at)
           VALUES ('${TENANT_A}', '${ELECTIONS.draftA.id}', 'pdf', 'x', now())`,
        ),
      ),
    ).toBe(RESTRICT_VIOLATION);
  });
});

describe('app.source_texts', () => {
  it('normalizes each page for matching', async () => {
    const [row] = await inRolledBackTransaction(
      async (client) =>
        (
          await client.query(
            `SELECT normalized = private.normalize_for_match(body) AS same FROM app.source_texts
            WHERE source_document_id = $1 AND unit_index = 1`,
            [SOURCES.liveA.id],
          )
        ).rows,
    );
    expect(row).toEqual({ same: true });
  });

  it('is added only to a pending source with a stored copy, not even by the owner otherwise', async () => {
    await asOwner(async (client) => {
      const page = (source: string): string =>
        `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES ('${source}', '${TENANT_A}', 9, 'p. 9', 'Texto añadido después')`;
      expect(await errorCode(client, page(SOURCES.liveA.id))).toBe(RESTRICT_VIOLATION); // already extracted
      expect(await errorCode(client, page(SOURCES.draftA.id))).toBe(RESTRICT_VIOLATION); // no stored copy
    });
  });

  it('is never changed or removed, not even by the owner', async () => {
    await asOwner(async (client) => {
      const page = `source_document_id = '${SOURCES.liveA.id}' AND unit_index = 1`;
      expect(
        await errorCode(client, `UPDATE app.source_texts SET body = 'otro' WHERE ${page}`),
      ).toBe(RESTRICT_VIOLATION);
      expect(await errorCode(client, `DELETE FROM app.source_texts WHERE ${page}`)).toBe(
        RESTRICT_VIOLATION,
      );
    });
  });
});
