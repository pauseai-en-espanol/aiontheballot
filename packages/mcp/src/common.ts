import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as z from 'zod';

import { AdminError } from './admin-client.js';

/** Why the admin refused, in words a tool can act on. */
const REASONS: Readonly<Record<string, string>> = {
  notForTokens:
    'A token can’t do this: a person does it in the admin (submitting, publishing, approving, settings, members…).',
  forbidden:
    'The database refused it: a token drafts and never decides (a cell’s review, recheck, report, change kind or ' +
    'public note), and the member’s roles may not allow it either.',
  changeControlled:
    'The election is live: propose a change to it or its parties with propose_change, and a person approves it in ' +
    'the admin; its criteria and methodology are a person’s to change there.',
  notFound:
    'No such site, election, party, criterion, cell, source or change, or not one this member can open.',
  taken: 'That short name (slug) is taken in this election, or that cell already exists.',
  invalid: 'A value was refused: check the field named.',
  incomplete:
    'Something it needs is missing, or the source can’t be cited or checked: check the field named.',
  linked: 'Something it names is gone, or something still rests on it.',
  stale:
    'It changed meanwhile, or the election is live and changes only through an approved change: read it again, and ' +
    'retry only if it is still a draft or in preview. A cell in review takes no edit until it is back in draft.',
  cellChanged:
    'The cell changed since its version was read (someone edited it in the admin): read it again with get_cell, ' +
    'show the member what changed, and write only what they accept again.',
  limit: 'A limit was reached: wait and try again later.',
  noCell: 'This party and criterion have no cell yet: start one with start_cell.',
  unmatched:
    'The quote isn’t in the source’s text, as the database matches it: copy it again exactly from read_source. ' +
    '`detail.longest` is the longest start or end of it that is there; the difference is right after (or before) it.',
  notMatched:
    'Only a PDF or a web page whose text is extracted takes a quote from a tool: a quote from any other source is ' +
    'attested by a person in the admin, against a screenshot or a clip.',
  tooShort: 'A quote needs at least 15 characters, counted as the database counts them.',
  tooLong: 'A quote has 1,000 characters at most.',
};

/** A refusal the tool makes itself, before asking the admin, with what it found. */
export class ToolRefusal extends Error {
  constructor(
    readonly key: string,
    readonly detail?: unknown,
  ) {
    super(`Refused: ${key}`);
  }
}

const answer = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }],
});

const refused = (value: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

const refusal = (error: unknown): CallToolResult => {
  if (error instanceof AdminError) {
    return refused({
      status: error.status,
      error: error.key ?? null,
      ...(error.field === undefined ? {} : { field: error.field }),
      reason:
        (error.key !== undefined ? REASONS[error.key] : undefined) ??
        (error.status === 401
          ? 'The token is unknown, expired or revoked: mint another in the admin.'
          : 'The admin refused it.'),
    });
  }
  if (error instanceof ToolRefusal) {
    return refused({
      error: error.key,
      reason: REASONS[error.key] ?? 'Refused.',
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    });
  }
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
};

export const run = async (work: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return answer(await work());
  } catch (error) {
    return refusal(error);
  }
};

export const segment = (value: string) => encodeURIComponent(value);
export const sitePath = (site: string) => `/api/t/${segment(site)}`;
export const electionPath = (site: string, election: string) =>
  `${sitePath(site)}/e/${segment(election)}`;

/** A short name, as sites and elections have them: nothing a path could take as more than one segment. */
const SHORT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const site = z
  .string()
  .regex(SHORT_NAME)
  .describe('The site’s short name, as list_sites gives it');
export const election = z
  .string()
  .regex(SHORT_NAME)
  .describe('The election’s short name (slug), as list_elections gives it');
export const localized = (what: string) =>
  z
    .record(z.string(), z.string())
    .describe(
      `${what}, by language code, such as {"es": "…", "en": "…"}; the site's main language is needed`,
    );
export const slug = z
  .string()
  .regex(SHORT_NAME)
  .describe('A short name for addresses: lowercase letters, digits and hyphens');

export const FACTS = ' Only facts from official sources or the party’s own; never invent any.';
