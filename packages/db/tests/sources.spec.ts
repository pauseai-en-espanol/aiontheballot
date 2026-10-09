import type pg from 'pg';

import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, FILES, SOURCES, TENANT_A, USERS } from './rls/matrix.js';

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

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

  it('keeps its copy, and everything about it, once stored', async () => {
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
