import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';

import { sql, type Transaction } from 'kysely';

import { databaseRefusal } from './database-errors.js';
import { normaliseAddress } from './signups.js';

/**
 * The right-of-reply form's intake (BRIEF §4; editorial workflow H2; PLAN R149), as aiontheballot_web, whose only
 * write is `app.submit_report()` (ADR-0002 §7): it checks the site is active, the election public and the site's, the
 * cell the election's, and caps a site's reports per UTC day. The API resolves the slugs the form sends to ids as the
 * public role, so a report can name only what the public sees: a cell with a published rating. A pending cell's slugs
 * go into the message instead, for the editors to read. Nothing of a report is ever logged.
 */

export type ReportKind = 'error_report' | 'party_response';

export interface ReportInput {
  kind: ReportKind;
  message: string;
  /** The election's slug: the form lives under it. */
  election: string;
  /** The cell, by its party's and criterion's slugs, when the form was opened from one. */
  party?: string;
  criterion?: string;
  name?: string;
  email?: string;
  organization?: string;
  partyRepresentative?: boolean;
}

/**
 * What the form says back: taken; no such site, election or cell; a field it can't take (or too many links, a spam
 * sign); or the site's limit for the day.
 */
export type ReportOutcome = 'accepted' | 'not-found' | 'invalid' | 'links' | 'limit';

/** The message's limit, as the column has it, less room for a pending cell's slugs. */
export const MAX_MESSAGE = 4_800;
/** More links than this is spam in all likelihood; a party's answer cites a page or two. */
export const MAX_LINKS = 5;
const MAX_FIELD = 200;

/**
 * Text as typed, trimmed, or undefined when blank; refused (null) past `max` characters, with control characters (a
 * message keeps its line breaks and tabs), or with characters that change how text shows without being seen: in a
 * name, any formatting character; in a message, the bidirectional overrides and isolates, which can make a link read
 * as another (zero-width joiners stay, which emoji need).
 */
const field = (
  value: string | undefined,
  max: number,
  lines = false,
): string | undefined | null => {
  const text = value?.replace(/\r\n?/gu, '\n').trim();
  if (!text) {
    return undefined;
  }
  const checked = lines ? text.replace(/[\n\t]/gu, '') : text;
  const hidden = lines ? /[\u202A-\u202E\u2066-\u2069]/u : /\p{Cf}/u;
  return Array.from(text).length > max || /\p{Cc}/u.test(checked) || hidden.test(text)
    ? null
    : text;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/** How many links the text holds: what a spammer's message is made of. */
export const linkCount = (text: string): number => text.match(/https?:\/\/|www\./giu)?.length ?? 0;

export const submitReport = async (
  db: Database | Transaction<DB>,
  slug: string,
  input: ReportInput,
): Promise<ReportOutcome> => {
  const message = field(input.message, MAX_MESSAGE, true);
  const name = field(input.name, MAX_FIELD);
  const organization = field(input.organization, MAX_FIELD);
  const email = input.email?.trim() ? normaliseAddress(input.email) : undefined;
  if (
    !message ||
    name === null ||
    organization === null ||
    (input.email?.trim() && !email) ||
    !SLUG.test(input.election) ||
    (input.party !== undefined && !SLUG.test(input.party)) ||
    (input.criterion !== undefined && !SLUG.test(input.criterion)) ||
    (input.party === undefined) !== (input.criterion === undefined)
  ) {
    return 'invalid';
  }
  if (linkCount(message) > MAX_LINKS) {
    return 'links';
  }
  // In one snapshot; inside a caller's transaction (a test's), in that one.
  const inTransaction = <T>(run: (trx: Transaction<DB>) => Promise<T>): Promise<T> =>
    db.isTransaction ? run(db as Transaction<DB>) : db.transaction().execute(run);
  return inTransaction(async (trx) => {
    const found = await trx
      .selectFrom('app.tenants as t')
      .innerJoin('app.elections as e', 'e.tenant_id', 't.id')
      .select(['t.id as tenant_id', 'e.id as election_id'])
      .where('t.slug', '=', slug)
      .where('e.slug', '=', input.election)
      .where('e.status', 'in', ['live', 'archived'])
      .executeTakeFirst();
    if (!found) {
      return 'not-found';
    }
    let assessment: string | null = null;
    let context = '';
    if (input.party !== undefined && input.criterion !== undefined) {
      const cell = await trx
        .selectFrom('app.parties as p')
        .innerJoin('app.criteria as c', 'c.election_id', 'p.election_id')
        .leftJoin('app.assessment_revisions as r', (join) =>
          join.onRef('r.party_id', '=', 'p.id').onRef('r.criterion_id', '=', 'c.id'),
        )
        .select(['r.assessment_id'])
        .where('p.election_id', '=', found.election_id)
        .where('p.slug', '=', input.party)
        .where('c.slug', '=', input.criterion)
        .limit(1)
        .executeTakeFirst();
      if (!cell) {
        return 'not-found';
      }
      assessment = cell.assessment_id;
      // A cell the public can't see as one (no published rating yet): its slugs, for the editors.
      if (!assessment) {
        context = `${input.party} · ${input.criterion}\n\n`;
      }
    }
    try {
      await sql`
        SELECT app.submit_report(${found.tenant_id}::uuid, ${input.kind}::app.report_kind, ${context + message},
                                 ${found.election_id}::uuid, ${assessment}::uuid, ${name ?? null}, ${email ?? null},
                                 ${organization ?? null}, ${input.partyRepresentative === true})`.execute(
        trx,
      );
      return 'accepted';
    } catch (error) {
      switch (databaseRefusal(error).status) {
        // No such site, election or cell, as the function sees them.
        case 400:
          return 'not-found';
        case 422:
          return 'invalid';
        case 429:
          return 'limit';
        default:
          throw error;
      }
    }
  });
};
