import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';

import { sql, type Transaction } from 'kysely';

/**
 * A published "not mentioned" that rests only on replaced documents (D20, PLAN R187): every document it was checked
 * against has since been marked replaced (D14), so the rating says nothing about the newer version, a party's new
 * programme. Shown as a warning, never refused: editors check the newer version and correct the cell, or don't.
 */
export interface Recheck {
  party: { id: string; slug: string; name: Localized };
  criterion: { id: string; slug: string; title: Localized };
  /** When the rating was published. */
  publishedAt: string;
  /** When the last of its checked documents was marked replaced. */
  replacedAt: string;
}

/**
 * The election's published "not mentioned" ratings whose checked documents are all replaced, in the parties' and
 * criteria's order, read under RLS (any member). Retired parties and criteria, whose cells the public no longer sees,
 * are left out. The party's page shows its own of them.
 */
export const listRechecks = async (
  trx: Transaction<DB>,
  electionId: string,
): Promise<Recheck[]> => {
  const { rows } = await sql<{
    party_id: string;
    party_slug: string;
    party_name: Localized;
    criterion_id: string;
    criterion_slug: string;
    criterion_title: Localized;
    published_at: string;
    replaced_at: string;
  }>`
    SELECT p.id AS party_id, p.slug AS party_slug, p.name AS party_name,
           c.id AS criterion_id, c.slug AS criterion_slug, c.title AS criterion_title,
           to_json(r.published_at) #>> '{}' AS published_at,
           to_json((SELECT max(s.replaced_at) FROM app.revision_checked_documents d
                      JOIN app.source_documents s ON s.id = d.source_document_id
                     WHERE d.revision_id = r.id)) #>> '{}' AS replaced_at
      FROM app.current_revisions r
      JOIN app.parties p ON p.id = r.party_id
      JOIN app.criteria c ON c.id = r.criterion_id
     WHERE r.election_id = ${electionId}
       AND r.rating = 'not_mentioned'
       AND p.retired_at IS NULL AND c.retired_at IS NULL
       AND EXISTS (SELECT 1 FROM app.revision_checked_documents d WHERE d.revision_id = r.id)
       AND NOT EXISTS (SELECT 1 FROM app.revision_checked_documents d
                         JOIN app.source_documents s ON s.id = d.source_document_id
                        WHERE d.revision_id = r.id AND s.replaced_at IS NULL)
     ORDER BY p.display_order, p.slug, c.display_order, c.slug`.execute(trx);
  return rows.map((row) => ({
    party: { id: row.party_id, slug: row.party_slug, name: row.party_name },
    criterion: { id: row.criterion_id, slug: row.criterion_slug, title: row.criterion_title },
    publishedAt: row.published_at,
    replacedAt: row.replaced_at,
  }));
};
