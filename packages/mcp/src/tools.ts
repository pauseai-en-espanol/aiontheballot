import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as z from 'zod';

import { type AdminClient, AdminError } from './admin-client.js';
import { readLogo } from './logo.js';

/** Why the admin refused, in words a tool can act on. */
const REASONS: Readonly<Record<string, string>> = {
  notForTokens:
    'A token can’t do this: a person does it in the admin (publishing, approving, settings, members…).',
  forbidden:
    'The database refused it: a token drafts and never decides, and the member’s roles may not allow it either.',
  changeControlled:
    'The election is live: propose a change to it or its parties with propose_change, and a person approves it in ' +
    'the admin; its criteria and methodology are a person’s to change there.',
  notFound: 'No such site, election, party, criterion or change, or not one this member can open.',
  taken: 'That short name (slug) is taken in this election.',
  invalid: 'A value was refused: check the field named.',
  stale:
    'It changed meanwhile, or the election is live and changes only through an approved change: read it again, and ' +
    'retry only if it is still a draft or in preview.',
  limit: 'A limit was reached: wait and try again later.',
};

const FACTS = ' Only facts from official sources or the party’s own; never invent any.';
/** Criteria are the chapter's words (CLAUDE.md): a tool carries them, never writes them (PLAN R213). */
const CHAPTER_WORDS =
  ' Only the exact wording a person of the site gave and approved for it, in the languages they gave it in; ' +
  'never write, complete, reword or translate any.';

const answer = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? { ok: true }, null, 2) }],
});

const refusal = (error: unknown): CallToolResult => {
  if (error instanceof AdminError) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: error.status,
              error: error.key ?? null,
              ...(error.field === undefined ? {} : { field: error.field }),
              reason:
                (error.key !== undefined ? REASONS[error.key] : undefined) ??
                (error.status === 401
                  ? 'The token is unknown, expired or revoked: mint another in the admin.'
                  : 'The admin refused it.'),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
};

const run = async (work: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return answer(await work());
  } catch (error) {
    return refusal(error);
  }
};

const segment = (value: string) => encodeURIComponent(value);
const sitePath = (site: string) => `/api/t/${segment(site)}`;
const electionPath = (site: string, election: string) => `${sitePath(site)}/e/${segment(election)}`;

/** A short name, as sites and elections have them: nothing a path could take as more than one segment. */
const SHORT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const site = z.string().regex(SHORT_NAME).describe('The site’s short name, as list_sites gives it');
const election = z
  .string()
  .regex(SHORT_NAME)
  .describe('The election’s short name (slug), as list_elections gives it');
const localized = (what: string) =>
  z
    .record(z.string(), z.string())
    .describe(
      `${what}, by language code, such as {"es": "…", "en": "…"}; the site's main language is needed`,
    );
const slug = z
  .string()
  .regex(SHORT_NAME)
  .describe('A short name for addresses: lowercase letters, digits and hyphens');

interface Party {
  id: string;
  slug: string;
  name: Record<string, string>;
  shortName: Record<string, string>;
  colour: string | null;
  website: string | null;
  territoryCodes: string[] | null;
}

interface Criterion {
  id: string;
  slug: string;
  title: Record<string, string>;
  shortTitle: Record<string, string> | null;
  description: Record<string, string>;
  coreCriterionId: string | null;
}

const criterionFields = {
  title: localized('The criterion’s title, as the chapter worded it'),
  shortTitle: localized(
    'Its short title, the public table’s column header (40 characters at most)',
  ),
  description: localized('What meets it, as the chapter worded it'),
};

const partyFields = {
  name: localized('The party’s full name'),
  shortName: localized('Its short name or acronym'),
  colour: z
    .string()
    .regex(/^#[\da-f]{6}$/i)
    .transform((value) => value.toLowerCase())
    .nullable()
    .describe('Its colour as #rrggbb, from its own sources; null for none'),
  website: z
    .url({ protocol: /^https?$/ })
    .nullable()
    .describe('Its own website, http or https; null for none'),
  territoryCodes: z
    .array(z.string())
    .nullable()
    .describe(
      'Where it stands, as the country’s subdivision codes (such as "ES-CT"); null for the whole election',
    ),
};

/** The tools, each a route a token may reach (ADR-0008): reading, and drafting an election's parties and criteria. */
export const registerTools = (
  server: McpServer,
  admin: AdminClient,
  /** The folder logos may be uploaded from (AIONTHEBALLOT_LOGO_DIR); without it, none is. */
  logoFolder?: string,
): void => {
  server.registerTool(
    'list_sites',
    {
      title: 'List sites',
      description: 'The sites this member works on, with their short names and main language.',
      inputSchema: {},
    },
    () => run(() => admin.get('/api/tenants')),
  );

  server.registerTool(
    'list_elections',
    {
      title: 'List elections',
      description:
        'A site’s elections: short name, name, type, date and status (draft, preview, live, archived).',
      inputSchema: { site },
    },
    ({ site: s }) => run(() => admin.get(`${sitePath(s)}/elections`)),
  );

  server.registerTool(
    'get_election',
    {
      title: 'Get an election',
      description: 'One election, with what this member may do in it.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) => run(() => admin.get(electionPath(s, e))),
  );

  server.registerTool(
    'create_election',
    {
      title: 'Create an election',
      description:
        'A new election, always a draft that only the admin shows; a person announces it or makes it live there.' +
        FACTS,
      inputSchema: {
        site,
        slug,
        type: z.enum(['general', 'european', 'regional', 'municipal', 'other']),
        name: localized('Its name'),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Its date, as YYYY-MM-DD, from an official source'),
        territoryCode: z
          .string()
          .nullable()
          .describe('For a regional or municipal one, its territory’s code; null otherwise'),
      },
    },
    ({ site: s, ...body }) => run(() => admin.send('POST', `${sitePath(s)}/elections`, body)),
  );

  server.registerTool(
    'list_parties',
    {
      title: 'List parties',
      description:
        'An election’s parties, in their order, with their ids, names, colours, websites and territories.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) => run(() => admin.get(`${electionPath(s, e)}/parties`)),
  );

  server.registerTool(
    'create_party',
    {
      title: 'Create a party',
      description:
        'Adds a party to an election not yet live (a live one’s changes go through propose_change).' +
        FACTS,
      inputSchema: { site, election, slug, ...partyFields },
    },
    ({ site: s, election: e, ...body }) =>
      run(() => admin.send('POST', `${electionPath(s, e)}/parties`, body)),
  );

  server.registerTool(
    'update_party',
    {
      title: 'Update a party',
      description:
        'Changes some of a party’s fields in an election not yet live; the others stay as they are (an edit a ' +
        'person makes at the same moment can be overwritten).' +
        FACTS,
      inputSchema: {
        site,
        election,
        party: z.string().uuid().describe('The party’s id, as list_parties gives it'),
        slug: slug.optional(),
        name: partyFields.name.optional(),
        shortName: partyFields.shortName.optional(),
        colour: partyFields.colour.optional(),
        website: partyFields.website.optional(),
        territoryCodes: partyFields.territoryCodes.optional(),
      },
    },
    ({ site: s, election: e, party, ...changes }) =>
      run(async () => {
        const path = `${electionPath(s, e)}/parties`;
        const { parties } = (await admin.get(path)) as { parties: Party[] };
        const current = parties.find((found) => found.id === party);
        if (!current) {
          throw new AdminError(404, 'notFound');
        }
        const { id: _id, ...fields } = {
          id: current.id,
          slug: changes.slug ?? current.slug,
          name: changes.name ?? current.name,
          shortName: changes.shortName ?? current.shortName,
          colour: changes.colour === undefined ? current.colour : changes.colour,
          website: changes.website === undefined ? current.website : changes.website,
          territoryCodes:
            changes.territoryCodes === undefined ? current.territoryCodes : changes.territoryCodes,
        };
        return admin.send('PUT', `${path}/${segment(party)}`, fields);
      }),
  );

  server.registerTool(
    'reorder_parties',
    {
      title: 'Reorder parties',
      description:
        'Sets the order an election’s parties are shown in, by their ids, every party once. `shown` is the order ' +
        'list_parties gave, so a change someone made meanwhile is refused rather than overwritten.',
      inputSchema: {
        site,
        election,
        shown: z.array(z.string().uuid()).min(1),
        ids: z.array(z.string().uuid()).min(1),
      },
    },
    ({ site: s, election: e, shown, ids }) =>
      run(() => admin.send('PUT', `${electionPath(s, e)}/parties/order`, { shown, ids })),
  );

  server.registerTool(
    'list_criteria',
    {
      title: 'List criteria',
      description:
        'An election’s criteria, in their order, with their ids, titles, short titles and descriptions.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) => run(() => admin.get(`${electionPath(s, e)}/criteria`)),
  );

  server.registerTool(
    'create_criterion',
    {
      title: 'Create a criterion',
      description:
        'Adds a criterion to an election not yet live, after the others; never linked to a core criterion, which ' +
        'a person does in the admin.' +
        CHAPTER_WORDS,
      inputSchema: { site, election, slug, ...criterionFields },
    },
    ({ site: s, election: e, ...body }) =>
      run(() =>
        admin.send('POST', `${electionPath(s, e)}/criteria`, { ...body, coreCriterionId: null }),
      ),
  );

  server.registerTool(
    'update_criterion',
    {
      title: 'Update a criterion',
      description:
        'Changes some of a criterion’s fields in an election not yet live; the others, and its core criterion, ' +
        'stay as they are (an edit a person makes at the same moment can be overwritten).' +
        CHAPTER_WORDS,
      inputSchema: {
        site,
        election,
        criterion: z.string().uuid().describe('The criterion’s id, as list_criteria gives it'),
        slug: slug.optional(),
        title: criterionFields.title.optional(),
        shortTitle: criterionFields.shortTitle.optional(),
        description: criterionFields.description.optional(),
      },
    },
    ({ site: s, election: e, criterion, ...changes }) =>
      run(async () => {
        const path = `${electionPath(s, e)}/criteria`;
        const { criteria } = (await admin.get(path)) as { criteria: Criterion[] };
        const current = criteria.find((found) => found.id === criterion);
        if (!current) {
          throw new AdminError(404, 'notFound');
        }
        return admin.send('PUT', `${path}/${segment(criterion)}`, {
          slug: changes.slug ?? current.slug,
          title: changes.title ?? current.title,
          shortTitle: changes.shortTitle ?? current.shortTitle ?? {},
          description: changes.description ?? current.description,
          coreCriterionId: current.coreCriterionId,
        });
      }),
  );

  server.registerTool(
    'reorder_criteria',
    {
      title: 'Reorder criteria',
      description:
        'Sets the order an election’s criteria are shown in, by their ids, every criterion once. `shown` is the ' +
        'order list_criteria gave, so a change someone made meanwhile is refused rather than overwritten.',
      inputSchema: {
        site,
        election,
        shown: z.array(z.string().uuid()).min(1),
        ids: z.array(z.string().uuid()).min(1),
      },
    },
    ({ site: s, election: e, shown, ids }) =>
      run(() => admin.send('PUT', `${electionPath(s, e)}/criteria/order`, { shown, ids })),
  );

  server.registerTool(
    'set_party_logo',
    {
      title: 'Set a party’s logo',
      description:
        'Uploads a logo for a party of an election not yet live, from a file in the folder set aside for logos ' +
        '(AIONTHEBALLOT_LOGO_DIR) and nowhere else: a PNG, JPEG or WebP of 2 MB at most, from the party’s own ' +
        'sources. Square fits the site’s box best; an SVG must be turned into a PNG first.',
      inputSchema: {
        site,
        election,
        party: z.string().uuid().describe('The party’s id, as list_parties gives it'),
        file: z
          .string()
          .min(1)
          .describe('The image file’s full path, inside AIONTHEBALLOT_LOGO_DIR'),
      },
    },
    ({ site: s, election: e, party, file }) =>
      run(async () => {
        const logo = await readLogo(logoFolder, file);
        return admin.upload(
          `${electionPath(s, e)}/parties/${segment(party)}/logo?filename=${encodeURIComponent(logo.filename)}`,
          logo.bytes,
          logo.contentType,
        );
      }),
  );

  server.registerTool(
    'list_changes',
    {
      title: 'List proposed changes',
      description: 'A live election’s change requests, pending and decided.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) => run(() => admin.get(`${electionPath(s, e)}/changes`)),
  );

  server.registerTool(
    'propose_change',
    {
      title: 'Propose a change',
      description:
        'Proposes a change to a live election, to a party (added, updated or retired) or to the election itself, ' +
        'with a note saying what changed and why, which the public sees once a person approves it in the admin.' +
        FACTS,
      inputSchema: {
        site,
        election,
        action: z.enum(['add', 'update', 'retire']),
        // Parties and the election: never criteria or the methodology, whose words are the chapter's (CLAUDE.md).
        targetKind: z.enum(['election', 'party']),
        targetId: z.string().uuid().nullable().describe('What it changes; null when adding'),
        field: z.string().nullable().describe('The one field it changes, or null with `values`'),
        value: z.unknown().optional().describe('The field’s new value'),
        values: z.record(z.string(), z.unknown()).optional().describe('Several fields at once'),
        publicNote: localized('The note the public sees, saying what changed and why'),
      },
    },
    ({ site: s, election: e, ...body }) =>
      run(() => admin.send('POST', `${electionPath(s, e)}/changes`, body)),
  );

  server.registerTool(
    'withdraw_change',
    {
      title: 'Withdraw a proposed change',
      description: 'Withdraws a change this member proposed that is still pending.',
      inputSchema: { site, election, change: z.string().uuid() },
    },
    ({ site: s, election: e, change }) =>
      run(() => admin.send('DELETE', `${electionPath(s, e)}/changes/${segment(change)}`)),
  );
};
