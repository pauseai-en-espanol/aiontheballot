import { METHODOLOGY_KINDS, RATINGS } from '@aiontheballot/domain/methodology';
import { describe, expect, it } from 'vitest';

import { errorCode, inRolledBackTransaction } from './db.js';

/** The enumerations of the data model spec (§2), in declaration order. */
const SPEC: Readonly<Record<string, readonly string[]>> = {
  tenant_role: ['country_admin', 'editor', 'reviewer'],
  org_role: ['operator', 'endorser'],
  election_type: ['general', 'european', 'regional', 'municipal', 'other'],
  election_status: ['draft', 'live', 'archived'],
  methodology_kind: ['demands', 'descriptive'],
  rating: ['meets', 'partially_meets', 'does_not_meet', 'green', 'yellow', 'red', 'not_mentioned'],
  assessment_state: ['draft', 'in_review', 'published'],
  change_kind: ['initial', 'update', 'correction', 'withdrawal'],
  source_kind: ['pdf', 'web_page', 'social_post', 'video', 'audio', 'party_submission'],
  match_status: ['unmatched', 'matched', 'attested'],
  extraction_status: ['pending', 'done', 'failed', 'not_applicable'],
  programme_status: ['pending', 'published'],
  file_bucket: ['public_assets', 'sources'],
  review_event_kind: ['submitted', 'recalled', 'approved', 'rejected', 'commented'],
  change_action: ['update', 'add', 'retire'],
  change_request_state: ['pending', 'approved', 'rejected'],
  report_kind: ['error_report', 'party_response'],
  report_status: ['new', 'triaged', 'accepted', 'rejected', 'spam'],
  suggestion_state: ['open', 'accepted', 'rejected'],
  evidence_origin: ['manual', 'llm', 'mcp'],
  job_kind: ['fetch_source', 'extract_source', 'archive_source', 'llm_run'],
  tenant_document_kind: ['privacy_policy', 'right_of_reply_policy', 'about_operator'],
};

const enumsInApp = async (): Promise<Record<string, string[]>> =>
  inRolledBackTransaction(async (client) => {
    const { rows } = await client.query<{ name: string; labels: string[] }>(
      `SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'app'
        GROUP BY t.typname`,
    );
    return Object.fromEntries(rows.map((r) => [r.name, r.labels]));
  });

describe('enumerations', () => {
  it('match the data model spec exactly, and nothing else is defined', async () => {
    expect(await enumsInApp()).toEqual(SPEC);
  });

  it('agree with the rating and methodology constants in @aiontheballot/domain', async () => {
    const enums = await enumsInApp();
    expect(enums['rating']).toEqual([...RATINGS]);
    expect(enums['methodology_kind']).toEqual([...METHODOLOGY_KINDS]);
  });

  it('are not usable by PUBLIC, which cannot create dependencies on them', async () => {
    const open = await inRolledBackTransaction(
      async (client) =>
        (
          await client.query<{ name: string }>(
            `SELECT t.typname AS name
               FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE n.nspname IN ('app', 'private') AND t.typtype IN ('e', 'd')
                AND has_type_privilege('public', t.oid, 'USAGE')`,
          )
        ).rows,
    );
    expect(open).toEqual([]);
  });

  it('can still be used in queries by every runtime role', async () => {
    await inRolledBackTransaction(async (client) => {
      for (const role of ['aiontheballot_web', 'aiontheballot_admin', 'aiontheballot_worker']) {
        await client.query(`SET LOCAL ROLE ${role}`);
        expect(
          await errorCode(client, `SELECT 'meets'::app.rating, '{pdf}'::app.source_kind[]`),
        ).toBeNull();
        await client.query('RESET ROLE');
      }
    });
  });
});
