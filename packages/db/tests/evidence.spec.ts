import type pg from 'pg';

import { matchQuote } from '@aiontheballot/domain/quote-match';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';
import { ELECTIONS, FILES, TENANT_A, USERS } from './rls/matrix.js';

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

/** Runs `fn` as the superuser, for setup the principal under test may not do, then returns to the admin role. */
const asSuperuser = async <T>(client: pg.Client, fn: () => Promise<T>): Promise<T> => {
  await client.query('RESET ROLE');
  const result = await fn();
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

const draftA = ELECTIONS.draftA;

interface SourceOptions {
  party?: string | null;
  kind?: string;
  /** Without a copy, the source has no stored file and stays pending. */
  copy?: boolean;
  /** The extracted pages; with none, `extraction` decides the final status. */
  pages?: readonly string[];
  extraction?: 'pending' | 'done' | 'failed' | 'not_applicable';
}

/** A source in A's draft election, added as the superuser the way the worker would. */
const source = (
  client: pg.Client,
  {
    party = draftA.party,
    kind = 'pdf',
    copy = true,
    pages = [],
    extraction = 'done',
  }: SourceOptions,
): Promise<string> =>
  asSuperuser(client, async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app.source_documents (tenant_id, election_id, party_id, kind, title)
       VALUES ($1, $2, $3, $4, 'Documento de ejemplo') RETURNING id`,
      [TENANT_A, draftA.id, party, kind],
    );
    const id = rows[0]!.id;
    if (!copy) {
      // A source with no copy can still be marked as having no text to extract.
      if (extraction === 'not_applicable') {
        await client.query(`UPDATE app.source_documents SET extraction_status = $1 WHERE id = $2`, [
          extraction,
          id,
        ]);
      }
      return id;
    }
    await client.query(
      `UPDATE app.source_documents SET file_id = $1, file_origin = 'uploaded' WHERE id = $2`,
      [FILES.sourceA.id, id],
    );
    for (const [index, body] of pages.entries()) {
      await client.query(
        `INSERT INTO app.source_texts (source_document_id, tenant_id, unit_index, label, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, TENANT_A, index + 1, `p. ${index + 1}`, body],
      );
    }
    if (extraction !== 'pending') {
      await client.query(`UPDATE app.source_documents SET extraction_status = $1 WHERE id = $2`, [
        extraction,
        id,
      ]);
    }
    return id;
  });

const PAGES = [
  'Primera página con una frase de ejemplo.',
  'Segunda página de ejemplo, sin nada más.',
];

/** A new cell in A's draft election, on its first party and criterion, written by the acting user. */
const newCell = async (client: pg.Client, rating = 'meets'): Promise<string> =>
  (
    await client.query<{ id: string }>(
      `INSERT INTO app.assessments (tenant_id, election_id, party_id, criterion_id, draft_rating, draft_summary)
       VALUES ($1, $2, $3, $4, $5, '{"es": "Resumen de ejemplo"}') RETURNING id`,
      [TENANT_A, draftA.id, draftA.party, draftA.criterion, rating],
    )
  ).rows[0]!.id;

const quoteSql = (cell: string, src: string, text: string, ordinal = 1): string =>
  `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote)
   VALUES ('${TENANT_A}', '${draftA.id}', '${cell}', '${src}', ${ordinal}, ${text})`;

const addQuote = async (client: pg.Client, cell: string, src: string, text: string, ordinal = 1) =>
  (
    await client.query<{
      id: string;
      match_status: string;
      matched_from_unit: number | null;
      matched_to_unit: number | null;
    }>(
      `${quoteSql(cell, src, `'${text}'`, ordinal)} RETURNING id, match_status, matched_from_unit, matched_to_unit`,
    )
  ).rows[0]!;

const evidence = async (client: pg.Client, id: string) =>
  (
    await client.query<{ match_status: string; attested_by: string | null }>(
      'SELECT match_status, attested_by FROM app.draft_evidence WHERE id = $1',
      [id],
    )
  ).rows[0];

const checkSql = (cell: string, src: string): string =>
  `INSERT INTO app.draft_checked_documents (assessment_id, tenant_id, election_id, source_document_id)
   VALUES ('${cell}', '${TENANT_A}', '${draftA.id}', '${src}')`;

/** Pages that exercise every rule of the match: normalisation, an empty page between two, characters beyond UTF-16. */
const PARITY_PAGES = [
  'Primera página: una «propuesta» de super-\nvisión ﬁcticia.',
  '',
  'Tercera página con votos 🗳🗳🗳 de ejemplo y más texto.',
  'Cuarta página, que sigue a la tercera sin más.',
];

describe("the editor's live match (W13)", () => {
  it.each([
    ['within a page, after normalisation', '"propuesta" de supervisión ficticia'],
    ['across a page break', 'y más texto. Cuarta página'],
    ['starting on the first character of a page', 'Cuarta página, que sigue'],
    ['across the empty page, which leaves two spaces', 'ficticia. Tercera página'],
    ['with characters beyond UTF-16', 'votos 🗳🗳🗳 de ejemplo'],
    ['of fourteen characters once normalised (sixteen UTF-16 units)', '🗳🗳 de ejemplo.\u00AD\u00AD'],
    ['nowhere', 'nada de esto aparece en el documento'],
  ])('agrees with the database on a quote %s', async (_name, quote) => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PARITY_PAGES });
      const saved = await addQuote(client, await newCell(client), src, quote.replaceAll("'", "''"));
      const live = matchQuote(
        quote,
        PARITY_PAGES.map((body, i) => ({ index: i + 1, label: `p. ${i + 1}`, body })),
      );
      expect({
        status: live.kind === 'matched' ? 'matched' : 'unmatched',
        from: live.kind === 'matched' ? live.span.fromUnit : null,
        to: live.kind === 'matched' ? live.span.toUnit : null,
      }).toEqual({
        status: saved.match_status,
        from: saved.matched_from_unit,
        to: saved.matched_to_unit,
      });
    });
  });
});

describe('the verbatim match', () => {
  it('matches a quote within a page and records the page', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      expect(
        await addQuote(client, await newCell(client), src, 'una frase de ejemplo'),
      ).toMatchObject({
        match_status: 'matched',
        matched_from_unit: 1,
        matched_to_unit: 1,
      });
    });
  });

  it('matches a quote across a page break and records both pages', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      expect(
        await addQuote(client, await newCell(client), src, 'frase de ejemplo. Segunda página'),
      ).toMatchObject({ match_status: 'matched', matched_from_unit: 1, matched_to_unit: 2 });
    });
  });

  it('matches through ligatures, typographic quotes, soft hyphens and words hyphenated across lines', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, {
        pages: ['Texto previo. La ﬁnanciación de la "regu-\nlación" pú­blica de ejemplo.'],
      });
      // The quote is normalized too: its ligature, typographic quotes and double space.
      expect(
        (
          await addQuote(
            client,
            await newCell(client),
            src,
            'La ﬁnanciación  de la “regulación” pública',
          )
        ).match_status,
      ).toBe('matched');
    });
  });

  it('leaves a quote that is not in the text unmatched', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      expect(
        await addQuote(client, await newCell(client), src, 'una frase que no aparece'),
      ).toMatchObject({
        match_status: 'unmatched',
        matched_from_unit: null,
        matched_to_unit: null,
      });
    });
  });

  it('needs at least 15 characters once normalized', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      const padded = `${'­'.repeat(12)}una`;
      expect((await addQuote(client, await newCell(client), src, padded)).match_status).toBe(
        'unmatched',
      );
    });
  });

  it('never takes the status from the caller', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      const cell = await newCell(client);
      const { rows } = await asSuperuser(client, () =>
        client.query(
          `INSERT INTO app.draft_evidence (tenant_id, election_id, assessment_id, source_document_id, ordinal, quote,
                                           match_status, matched_from_unit, matched_to_unit)
           VALUES ($1, $2, $3, $4, 1, 'una frase que no aparece', 'matched', 1, 2)
           RETURNING match_status, matched_from_unit, matched_to_unit`,
          [TENANT_A, draftA.id, cell, src],
        ),
      );
      expect(rows).toEqual([
        { match_status: 'unmatched', matched_from_unit: null, matched_to_unit: null },
      ]);
    });
  });

  it('runs again when the quote changes', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES });
      const { id } = await addQuote(client, await newCell(client), src, 'una frase de ejemplo');
      await client.query(
        `UPDATE app.draft_evidence SET quote = 'una frase cambiada de ejemplo' WHERE id = $1`,
        [id],
      );
      expect((await evidence(client, id))?.match_status).toBe('unmatched');
    });
  });
});

describe('a quote', () => {
  it.each([
    ['a source with no stored copy', { copy: false, extraction: 'not_applicable' as const }],
    ['a source whose text is pending', { extraction: 'pending' as const }],
    ['a source whose extraction failed', { extraction: 'failed' as const }],
    ["another party's source", { party: draftA.secondParty }],
    [
      'a kind the methodology does not admit',
      { kind: 'social_post', extraction: 'not_applicable' as const },
    ],
  ])('is refused from %s', async (_name, options) => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const src = await source(client, { pages: PAGES, ...options });
        return errorCode(client, quoteSql(await newCell(client), src, `'una frase de ejemplo'`));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('may come from a party-neutral source', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { pages: PAGES, party: null });
      expect(
        (await addQuote(client, await newCell(client), src, 'una frase de ejemplo')).match_status,
      ).toBe('matched');
    });
  });
});

describe('a checked document', () => {
  it.each([
    ['a source with no stored copy', { copy: false, extraction: 'not_applicable' as const }],
    ['a source whose text is pending', { extraction: 'pending' as const }],
    ["another party's source", { party: draftA.secondParty }],
    [
      'a kind the methodology does not list for "not mentioned"',
      { kind: 'video', extraction: 'not_applicable' as const },
    ],
  ])('is refused from %s', async (_name, options) => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const src = await source(client, { pages: PAGES, ...options });
        return errorCode(client, checkSql(await newCell(client, 'not_mentioned'), src));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('may be a party-neutral source', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const src = await source(client, { pages: PAGES, party: null });
        return errorCode(client, checkSql(await newCell(client, 'not_mentioned'), src));
      }),
    ).toBeNull();
  });
});

describe('attesting a quote', () => {
  /**
   * A quote by editor A from a scanned PDF (no text), with an attestation file in `bucket`; `fn` runs as `attester`.
   */
  const scanned = <T>(
    attester: string,
    fn: (client: pg.Client, quote: string) => Promise<T>,
    file: string | null = FILES.sourceA.id,
  ): Promise<T> =>
    actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { extraction: 'not_applicable' });
      const { id, match_status } = await addQuote(
        client,
        await newCell(client),
        src,
        'Una frase escaneada de ejemplo',
      );
      expect(match_status).toBe('unmatched');
      if (file) {
        await client.query('UPDATE app.draft_evidence SET attestation_file_id = $1 WHERE id = $2', [
          file,
          id,
        ]);
      }
      await setActor(client, attester);
      return fn(client, id);
    });
  const attest = (id: string, as: string = USERS.newcomer): string =>
    `UPDATE app.draft_evidence SET attested_by = '${as}' WHERE id = '${id}'`;

  it('records the attesting user, whoever the caller names', async () => {
    await scanned(USERS.reviewerA, async (client, id) => {
      await client.query(attest(id));
      expect(await evidence(client, id)).toEqual({
        match_status: 'attested',
        attested_by: USERS.reviewerA,
      });
    });
  });

  it("is refused to the quote's author while the election requires a second reviewer", async () => {
    expect(await scanned(USERS.editorA, (client, id) => errorCode(client, attest(id)))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it("is open to the quote's author once a platform admin turns that off", async () => {
    await scanned(USERS.editorA, async (client, id) => {
      await asUser(client, USERS.platformAdmin, () =>
        client.query('UPDATE app.elections SET require_second_reviewer = false WHERE id = $1', [
          draftA.id,
        ]),
      );
      await client.query(attest(id));
      expect((await evidence(client, id))?.match_status).toBe('attested');
    });
  });

  it.each([
    ['without an attestation file', null],
    ['with a file outside the sources bucket', FILES.logoA.id],
  ])('is refused %s', async (_name, file) => {
    expect(
      await scanned(USERS.reviewerA, (client, id) => errorCode(client, attest(id)), file),
    ).toBe(CHECK_VIOLATION);
  });

  it('is refused for a quote from a source with text, which is matched instead', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const src = await source(client, { pages: PAGES });
        const { id } = await addQuote(client, await newCell(client), src, 'una frase de ejemplo');
        await setActor(client, USERS.reviewerA);
        return errorCode(client, attest(id));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('is undone when the quote changes', async () => {
    await scanned(USERS.reviewerA, async (client, id) => {
      await client.query(attest(id));
      await setActor(client, USERS.editorA);
      await client.query(
        `UPDATE app.draft_evidence SET quote = 'Otra frase escaneada de ejemplo' WHERE id = $1`,
        [id],
      );
      expect(await evidence(client, id)).toEqual({ match_status: 'unmatched', attested_by: null });
    });
  });

  it("lapses when it no longer holds, such as the author's once a second reviewer is required again", async () => {
    await scanned(USERS.editorA, async (client, id) => {
      const fourEyes = (on: boolean) =>
        asUser(client, USERS.platformAdmin, () =>
          client.query('UPDATE app.elections SET require_second_reviewer = $1 WHERE id = $2', [
            on,
            draftA.id,
          ]),
        );
      await fourEyes(false);
      await client.query(attest(id));
      await fourEyes(true);
      await client.query('UPDATE app.draft_evidence SET attested_by = attested_by WHERE id = $1', [
        id,
      ]);
      expect(await evidence(client, id)).toEqual({ match_status: 'unmatched', attested_by: null });
    });
  });

  it('is undone when the quote moves to a source with text, which matches it instead', async () => {
    await scanned(USERS.reviewerA, async (client, id) => {
      await client.query(attest(id));
      const withText = await source(client, {
        pages: ['Una frase escaneada de ejemplo, ahora con texto.'],
      });
      await setActor(client, USERS.editorA);
      await client.query('UPDATE app.draft_evidence SET source_document_id = $1 WHERE id = $2', [
        withText,
        id,
      ]);
      expect(await evidence(client, id)).toEqual({ match_status: 'matched', attested_by: null });
    });
  });

  it('is set once: it can be withdrawn, not handed to someone else', async () => {
    await scanned(USERS.reviewerA, async (client, id) => {
      await client.query(attest(id));
      await setActor(client, USERS.countryAdminA);
      expect(await errorCode(client, attest(id))).toBe(RESTRICT_VIOLATION);
      await client.query('UPDATE app.draft_evidence SET attested_by = NULL WHERE id = $1', [id]);
      expect(await evidence(client, id)).toEqual({ match_status: 'unmatched', attested_by: null });
    });
  });
});

describe('submitting a rated cell', () => {
  const submit = (id: string): string =>
    `UPDATE app.assessments SET state = 'in_review' WHERE id = '${id}'`;

  it('needs every quote matched or attested', async () => {
    expect(
      await actingAs(USERS.editorA, async (client) => {
        const src = await source(client, { pages: PAGES });
        const cell = await newCell(client);
        await addQuote(client, cell, src, 'una frase de ejemplo', 1);
        await addQuote(client, cell, src, 'una frase que no aparece', 2);
        return errorCode(client, submit(cell));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('accepts an attested quote', async () => {
    await actingAs(USERS.editorA, async (client) => {
      const src = await source(client, { extraction: 'not_applicable' });
      const cell = await newCell(client);
      const { id } = await addQuote(client, cell, src, 'Una frase escaneada de ejemplo');
      await client.query('UPDATE app.draft_evidence SET attestation_file_id = $1 WHERE id = $2', [
        FILES.sourceA.id,
        id,
      ]);
      await asUser(client, USERS.reviewerA, () =>
        client.query('UPDATE app.draft_evidence SET attested_by = $1 WHERE id = $2', [
          USERS.reviewerA,
          id,
        ]),
      );
      expect(await errorCode(client, submit(cell))).toBeNull();
    });
  });

  it('checks the kinds of every checked document against the methodology now', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const own = await source(client, { pages: PAGES });
        const neutral = await source(client, { pages: PAGES, party: null, kind: 'web_page' });
        const cell = await newCell(client, 'not_mentioned');
        await client.query(checkSql(cell, own));
        await client.query(checkSql(cell, neutral));
        await client.query(
          `UPDATE app.methodologies SET not_mentioned_source_kinds = '{pdf}' WHERE id = $1`,
          [draftA.methodology],
        );
        return errorCode(client, submit(cell));
      }),
    ).toBe(CHECK_VIOLATION);
  });

  it('checks the kinds the methodology admits now, not when the quote was written', async () => {
    expect(
      await actingAs(USERS.countryAdminA, async (client) => {
        const src = await source(client, { pages: PAGES });
        const cell = await newCell(client);
        await addQuote(client, cell, src, 'una frase de ejemplo');
        await client.query(
          `UPDATE app.methodologies SET admissible_source_kinds = '{web_page}' WHERE id = $1`,
          [draftA.methodology],
        );
        return errorCode(client, submit(cell));
      }),
    ).toBe(CHECK_VIOLATION);
  });
});
