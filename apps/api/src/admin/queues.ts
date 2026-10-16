import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

import type { Access } from './access.js';

import { holds } from './access.js';

/**
 * The work queues on a site's dashboard (editorial workflow C1.2): what waits for the signed-in member, read in their
 * own `withActor` transaction, so RLS decides what each queue may hold; the roles only decide which queues are theirs to
 * act on. Each lists at most QUEUE_LIMIT items, oldest work first, with how many there are in all.
 */

export const QUEUE_LIMIT = 20;

type Localized = Record<string, string>;

export interface QueueElection {
  slug: string;
  name: Localized;
}

/** A cell, by the names its election's grid uses. */
export interface QueueCell {
  election: QueueElection;
  partyId: string;
  partyName: Localized;
  criterionId: string;
  criterionName: Localized;
}

export interface Queue<T> {
  total: number;
  items: T[];
}

export interface Queues {
  /** Drafts the member worked on, still with them. */
  drafts: Queue<QueueCell>;
  /** Drafts the member worked on that a reviewer sent back, until they are submitted again. */
  returned: Queue<QueueCell>;
  /** Cells in review the member didn't work on, for those who publish (reviewers, country admins, platform admins). */
  review: Queue<QueueCell> | null;
  /** Cells flagged for a recheck (C12), for those who clear the flag (editors, country admins, platform admins). */
  recheck: Queue<QueueCell> | null;
  /** Change requests waiting for a decision (CR1), for every member. */
  changes: Queue<{ id: string; election: QueueElection; targetKind: string; action: string }>;
  /** New right-of-reply reports (H2), for members, who triage them; none for whoever reads no reports (P11). */
  reports: number | null;
  /** Sources whose text couldn't be extracted (S3.5), for those who replace them (editors, country admins). */
  failedSources: Queue<{ id: string; election: QueueElection; title: string }> | null;
}

const queue = <T>(items: T[]): Queue<T> => ({
  total: items.length,
  items: items.slice(0, QUEUE_LIMIT),
});

export const workQueues = async (
  trx: Transaction<DB>,
  access: Access,
  userId: string,
): Promise<Queues> => {
  const { tenantId } = access;
  // Every cell of the site's elections whose party and criterion are still in the table, oldest change first, with
  // whether the member contributed to its current generation and its latest workflow event (comments don't count).
  const cells = await trx
    .selectFrom('app.assessments as a')
    .innerJoin('app.elections as e', 'e.id', 'a.election_id')
    .innerJoin('app.parties as p', 'p.id', 'a.party_id')
    .innerJoin('app.criteria as c', 'c.id', 'a.criterion_id')
    .select([
      'a.state',
      'a.recheck_reason',
      'e.slug as election_slug',
      'e.name as election_name',
      'p.id as party_id',
      'p.short_name as party_name',
      'c.id as criterion_id',
      sql<Localized>`coalesce(c.short_title, c.title)`.as('criterion_name'),
      sql<boolean>`EXISTS (SELECT 1 FROM app.assessment_contributors k
                            WHERE k.assessment_id = a.id AND k.generation = a.generation
                              AND k.user_id = ${userId})`.as('mine'),
      sql<string | null>`(SELECT r.kind::text FROM app.review_events r
                           WHERE r.assessment_id = a.id AND r.kind <> 'commented'
                           ORDER BY r.created_at DESC, r.id DESC LIMIT 1)`.as('last_event'),
    ])
    .where('a.tenant_id', '=', tenantId)
    .where('p.retired_at', 'is', null)
    .where('c.retired_at', 'is', null)
    .orderBy('a.updated_at')
    .orderBy('a.id')
    .execute();
  const cell = (row: (typeof cells)[number]): QueueCell => ({
    election: { slug: row.election_slug, name: row.election_name as Localized },
    partyId: row.party_id,
    partyName: row.party_name as Localized,
    criterionId: row.criterion_id,
    criterionName: row.criterion_name,
  });
  const ownDrafts = cells.filter((row) => row.state === 'draft' && row.mine);

  const changes = await trx
    .selectFrom('app.change_requests as q')
    .innerJoin('app.elections as e', 'e.id', 'q.election_id')
    .select(['q.id', 'q.target_kind', 'q.action', 'e.slug', 'e.name'])
    .where('q.tenant_id', '=', tenantId)
    .where('q.state', '=', 'pending')
    .orderBy('q.proposed_at')
    .execute();

  const failed = holds(access, 'editor', 'country_admin')
    ? await trx
        .selectFrom('app.source_documents as s')
        .innerJoin('app.elections as e', 'e.id', 's.election_id')
        .select(['s.id', 's.title', 'e.slug', 'e.name'])
        .where('s.tenant_id', '=', tenantId)
        .where('s.extraction_status', '=', 'failed')
        .orderBy('s.title')
        .execute()
    : undefined;

  // Platform admins read no reports (P11): only a role in the site shows them.
  const reports =
    access.roles.length > 0
      ? Number(
          (
            await trx
              .selectFrom('app.reports')
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .where('tenant_id', '=', tenantId)
              .where('status', '=', 'new')
              .executeTakeFirst()
          )?.n ?? 0,
        )
      : null;

  return {
    drafts: queue(ownDrafts.filter((row) => row.last_event !== 'rejected').map(cell)),
    returned: queue(ownDrafts.filter((row) => row.last_event === 'rejected').map(cell)),
    review: holds(access, 'reviewer', 'country_admin')
      ? queue(cells.filter((row) => row.state === 'in_review' && !row.mine).map(cell))
      : null,
    recheck: holds(access, 'editor', 'country_admin')
      ? queue(cells.filter((row) => row.recheck_reason !== null).map(cell))
      : null,
    changes: queue(
      changes.map((row) => ({
        id: row.id,
        election: { slug: row.slug, name: row.name as Localized },
        targetKind: row.target_kind,
        action: row.action,
      })),
    ),
    reports,
    failedSources: failed
      ? queue(
          failed.map((row) => ({
            id: row.id,
            election: { slug: row.slug, name: row.name as Localized },
            title: row.title,
          })),
        )
      : null,
  };
};
