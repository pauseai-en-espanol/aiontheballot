import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';
import type {
  PublicCell,
  PublicElection,
  PublicRevision,
  PublicSource,
} from '@aiontheballot/domain/public-election';

import { isLocalized } from '@aiontheballot/domain/localized';
import { isMethodologyKind, isRating } from '@aiontheballot/domain/methodology';
import { type Kysely, sql } from 'kysely';

/** A tenant's public election by slugs; undefined unless RLS shows it live or archived. */
export type ElectionSource = (
  slug: string,
  election: string,
) => Promise<PublicElection | undefined>;

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const optionalLocalized = (value: unknown, column: string): Localized | null =>
  value === null ? null : localized(value, column);

/** An instant as text: node-postgres would make a Date of it, which the JSON answer turns back into text anyway. */
const instant = (column: string) => sql<string>`to_json(${sql.ref(column)})#>>'{}'`;

const CHANGE_KINDS = ['initial', 'update', 'correction', 'withdrawal'] as const;

/**
 * Reads a public election as aiontheballot_web (public-site spec §5), so RLS decides what is public: the election must
 * be live or archived (an announced draft's own row is public, but nothing under it, and it isn't served), and only
 * published revisions exist. Sources come with their public columns only (data model §5). Every read sees one
 * snapshot, so a revision published meanwhile can't arrive without its evidence.
 */
export const createElectionSource =
  (db: Database): ElectionSource =>
  async (slug, electionSlug) =>
    // Within a caller's transaction (the tests'), that one.
    db.isTransaction
      ? readElection(db, slug, electionSlug)
      : db
          .transaction()
          .setIsolationLevel('repeatable read')
          .setAccessMode('read only')
          .execute((trx) => readElection(trx, slug, electionSlug));

const readElection = async (
  db: Kysely<DB>,
  slug: string,
  electionSlug: string,
): Promise<PublicElection | undefined> => {
  const election = await db
    .selectFrom('app.elections as e')
    .innerJoin('app.tenants as t', 't.id', 'e.tenant_id')
    .select([
      'e.id',
      'e.slug',
      'e.name',
      'e.status',
      // A date as text: pg would turn it into a Date at local midnight, which can shift the day.
      sql<string | null>`e.election_date::text`.as('date'),
    ])
    .where('t.slug', '=', slug)
    .where('e.slug', '=', electionSlug)
    .where('e.status', 'in', ['live', 'archived'])
    .executeTakeFirst();
  if (!election || (election.status !== 'live' && election.status !== 'archived')) {
    return undefined;
  }
  const [methodology, reviewers, parties, criteria, revisions, evidence, checked] =
    await Promise.all([
      db
        .selectFrom('app.methodologies as m')
        .leftJoin('app.organizations as o', 'o.id', 'm.demands_owner_id')
        .select(['m.kind', 'm.body', 'o.display_name as owner_name', 'o.url as owner_url'])
        .where('m.election_id', '=', election.id)
        .executeTakeFirst(),
      db
        .selectFrom('app.methodology_reviewers as r')
        .innerJoin('app.methodologies as m', 'm.id', 'r.methodology_id')
        .select(['r.name', 'r.affiliation'])
        .where('m.election_id', '=', election.id)
        .where('r.retired_at', 'is', null)
        .orderBy('r.display_order')
        .orderBy('r.name')
        .execute(),
      db
        .selectFrom('app.parties')
        .select([
          'id',
          'slug',
          'name',
          'short_name',
          'colour',
          'website',
          'programme_status',
          instant('programme_checked_at').as('programme_checked_at'),
        ])
        .where('election_id', '=', election.id)
        .where('retired_at', 'is', null)
        .orderBy('display_order')
        .orderBy('slug')
        .execute(),
      db
        .selectFrom('app.criteria')
        .select(['id', 'slug', 'title', 'short_title', 'description'])
        .where('election_id', '=', election.id)
        .where('retired_at', 'is', null)
        .orderBy('display_order')
        .orderBy('slug')
        .execute(),
      // The cells of the parties and criteria shown: a retired one's cells are history, not this election's.
      db
        .selectFrom('app.assessment_revisions as r')
        .innerJoin('app.parties as p', 'p.id', 'r.party_id')
        .innerJoin('app.criteria as c', 'c.id', 'r.criterion_id')
        .select([
          'r.id',
          'r.party_id',
          'r.criterion_id',
          'r.revision_no',
          'r.rating',
          'r.summary',
          'r.change_kind',
          'r.public_note',
          instant('r.published_at').as('published_at'),
        ])
        .where('r.election_id', '=', election.id)
        .where('p.retired_at', 'is', null)
        .where('c.retired_at', 'is', null)
        .orderBy('r.party_id')
        .orderBy('r.criterion_id')
        .orderBy('r.revision_no', 'desc')
        .execute(),
      db
        .selectFrom('app.revision_evidence as v')
        .innerJoin('app.source_documents as s', 's.id', 'v.source_document_id')
        .select([
          'v.revision_id',
          'v.quote',
          'v.location_label',
          's.title',
          's.language',
          's.url',
          's.kind',
          's.sha256',
          instant('s.retrieved_at').as('retrieved_at'),
          's.archive_url',
        ])
        .where('v.election_id', '=', election.id)
        .orderBy('v.revision_id')
        .orderBy('v.ordinal')
        .execute(),
      db
        .selectFrom('app.revision_checked_documents as c')
        .innerJoin('app.source_documents as s', 's.id', 'c.source_document_id')
        .select([
          'c.revision_id',
          instant('c.checked_at').as('checked_at'),
          's.title',
          's.language',
          's.url',
          's.kind',
          's.sha256',
          instant('s.retrieved_at').as('retrieved_at'),
          's.archive_url',
        ])
        .where('c.election_id', '=', election.id)
        .orderBy('c.revision_id')
        .orderBy('s.title')
        .execute(),
    ]);

  const source = (row: {
    title: string;
    language: string | null;
    url: string | null;
    kind: string;
    sha256: string | null;
    retrieved_at: string | null;
    archive_url: string | null;
  }): PublicSource => ({
    title: row.title,
    language: row.language,
    url: row.url,
    kind: row.kind,
    sha256: row.sha256,
    retrievedAt: row.retrieved_at,
    archiveUrl: row.archive_url,
  });

  const cells = new Map<string, PublicCell>();
  for (const row of revisions) {
    const key = `${row.party_id}:${row.criterion_id}`;
    const cell = cells.get(key) ?? {
      partyId: row.party_id,
      criterionId: row.criterion_id,
      revisions: [],
    };
    cells.set(key, cell);
    const changeKind = CHANGE_KINDS.find((kind) => kind === row.change_kind);
    if (!changeKind || (row.rating !== null && !isRating(row.rating))) {
      throw new Error(`Revision ${row.id} has a rating or change kind the site doesn't know`);
    }
    const revision: PublicRevision = {
      revisionNo: row.revision_no,
      rating: row.rating,
      summary: optionalLocalized(row.summary, 'assessment_revisions.summary'),
      changeKind,
      publicNote: optionalLocalized(row.public_note, 'assessment_revisions.public_note'),
      publishedAt: row.published_at,
      evidence: evidence
        .filter((item) => item.revision_id === row.id)
        .map((item) => ({
          quote: item.quote,
          locationLabel: item.location_label,
          source: source(item),
        })),
      checkedDocuments: checked
        .filter((item) => item.revision_id === row.id)
        .map((item) => ({ source: source(item), checkedAt: item.checked_at })),
    };
    cell.revisions.push(revision);
  }

  return {
    election: {
      slug: election.slug,
      name: localized(election.name, 'elections.name'),
      date: election.date,
      status: election.status,
    },
    methodology:
      methodology && isMethodologyKind(methodology.kind)
        ? {
            kind: methodology.kind,
            demandsOwner: methodology.owner_name
              ? {
                  name: localized(methodology.owner_name, 'organizations.display_name'),
                  url: methodology.owner_url,
                }
              : null,
            body: localized(methodology.body, 'methodologies.body'),
            reviewers,
          }
        : null,
    parties: parties.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: localized(p.name, 'parties.name'),
      shortName: localized(p.short_name, 'parties.short_name'),
      colour: p.colour,
      website: p.website,
      programmeStatus: p.programme_status,
      programmeCheckedAt: p.programme_checked_at,
    })),
    criteria: criteria.map((c) => ({
      id: c.id,
      slug: c.slug,
      title: localized(c.title, 'criteria.title'),
      shortTitle: optionalLocalized(c.short_title, 'criteria.short_title'),
      description: localized(c.description, 'criteria.description'),
    })),
    cells: [...cells.values()],
  };
};
