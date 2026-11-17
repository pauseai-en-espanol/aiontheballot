import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RATINGS } from '@aiontheballot/domain/methodology';
import { matchQuote, MAX_QUOTE_LENGTH } from '@aiontheballot/domain/quote-match';
import * as z from 'zod';

import type { AdminClient } from './admin-client.js';

import { election, electionPath, localized, run, segment, site, ToolRefusal } from './common.js';
import { readUnits, searchUnits, type Unit } from './source-text.js';

/**
 * The tools that draft an election's cells as the member (PLAN R232): a party's rating on a criterion, its summary, the
 * quotes that show it and the documents checked for "not mentioned". The member decides each one in their
 * conversation with the tool, which the database can't tell from one the tool chose alone: every description says so.
 * A token never takes a cell through review, deletes it or decides its recheck, report, change kind or public note
 * (ADR-0008); a person submits each draft in the admin.
 */

/** What every tool that writes a cell's draft says: the member's acceptance comes first. */
const ACCEPTED =
  ' Only what the member accepted in this conversation, exactly as they accepted it: propose it first, and write ' +
  'it once they say yes, one cell at a time. It stays a draft: the member submits it for review in the admin.';

interface CellQuote {
  id: string;
  ordinal: number;
  quote: string;
  sectionLabel: string | null;
  source: { id: string; title: string };
  matchStatus: string;
  location: string | null;
}

interface CellDraft {
  id: string;
  state: string;
  contentVersion: number;
  changeKind: string | null;
  publicNote: Record<string, string> | null;
  quotes: CellQuote[];
}

interface Cell {
  draft: CellDraft | null;
  [key: string]: unknown;
}

interface SourceListed {
  id: string;
  title: string;
  kind: string;
  language: string | null;
  partyId: string | null;
  isProgramme: boolean;
  extractionStatus: string;
  units: number;
  citable: boolean;
  citations: number;
  replacedAt?: string | null;
}

const id = (what: string) => z.string().uuid().describe(what);
const party = id('The party’s id, as list_parties or list_cells gives it');
const criterion = id('The criterion’s id, as list_criteria or list_cells gives it');
const version = z
  .number()
  .int()
  .nonnegative()
  .describe(
    'The cell’s version (`draft.contentVersion`) as last read with get_cell or written: a change made since is ' +
      'refused, not overwritten',
  );
const source = id('The source’s id, as list_sources or get_cell gives it');

/** The kinds of source whose quotes the database matches against their text (`private.evidence_rules`). */
const MATCHED_KINDS: ReadonlySet<string> = new Set(['pdf', 'web_page']);

export const registerCellTools = (server: McpServer, admin: AdminClient): void => {
  const cellsPath = (s: string, e: string) => `${electionPath(s, e)}/cells`;
  const cellPath = (s: string, e: string, p: string, c: string) =>
    `${cellsPath(s, e)}/${segment(p)}/${segment(c)}`;

  /** The cell as the admin shows it, without the names of the people its trail names: ids say enough to a tool. */
  const readCell = async (s: string, e: string, p: string, c: string): Promise<Cell> => {
    const { names: _names, you: _you, ...cell } = (await admin.get(cellPath(s, e, p, c))) as Cell;
    return cell;
  };

  /** The cell's draft, or a refusal saying to start it. */
  const draftOf = async (s: string, e: string, p: string, c: string): Promise<CellDraft> => {
    const { draft } = await readCell(s, e, p, c);
    if (!draft) {
      throw new ToolRefusal('noCell');
    }
    return draft;
  };

  /**
   * The cell's draft to write to, or a refusal before anything is sent: a cell in review takes no edit until a person
   * recalls it to draft in the admin, or a reviewer sends it back.
   */
  const editableDraft = async (s: string, e: string, p: string, c: string): Promise<CellDraft> => {
    const draft = await draftOf(s, e, p, c);
    if (draft.state === 'in_review') {
      throw new ToolRefusal('inReview');
    }
    return draft;
  };

  server.registerTool(
    'list_cells',
    {
      title: 'List cells',
      description:
        'An election’s grid: its parties and criteria, and for each pair its cell’s id once it exists, its working ' +
        'state (none, draft, in review, published, changed since), what the public sees, a reviewer’s rejection ' +
        'and whether it is flagged to check again.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) => run(() => admin.get(cellsPath(s, e))),
  );

  server.registerTool(
    'get_cell',
    {
      title: 'Get a cell',
      description:
        'One party’s cell on one criterion: its draft (rating, summary, quotes with whether they match, the ' +
        'documents checked, its review’s history and its version), its published revisions, and the sources it ' +
        'may cite or check. Read it before proposing anything for it, and again before writing.',
      inputSchema: { site, election, party, criterion },
    },
    ({ site: s, election: e, party: p, criterion: c }) => run(() => readCell(s, e, p, c)),
  );

  server.registerTool(
    'list_sources',
    {
      title: 'List sources',
      description:
        'An election’s sources: their ids, titles, kinds, languages, parties, whether each is a programme, has its ' +
        'text (citable) and how many units (pages or sections) it has, and how many cells rest on it.',
      inputSchema: { site, election },
    },
    ({ site: s, election: e }) =>
      run(async () => {
        const { sources } = (await admin.get(`${electionPath(s, e)}/sources`)) as {
          sources: SourceListed[];
        };
        return {
          sources: sources.map((found) => ({
            id: found.id,
            title: found.title,
            kind: found.kind,
            language: found.language,
            partyId: found.partyId,
            isProgramme: found.isProgramme,
            citable: found.citable,
            extractionStatus: found.extractionStatus,
            units: found.units,
            cells: found.citations,
            replaced: Boolean(found.replacedAt),
          })),
        };
      }),
  );

  server.registerTool(
    'read_source',
    {
      title: 'Read a source',
      description:
        'A source’s extracted text, as it reads: with `search`, the passages around any of the words given (in ' +
        'lower case and without accents, as written otherwise), cut at whole words; with `from` and `to`, those ' +
        'units whole, a few at a time (`next` says where to go on); with neither, its units’ labels. Quote only ' +
        'from what it shows, copied exactly, never from memory or another copy of the document.',
      inputSchema: {
        site,
        election,
        source,
        search: z
          .array(z.string().min(2).max(100))
          .min(1)
          .max(10)
          .optional()
          .describe('Words or phrases to look for, any of them'),
        from: z.number().int().nonnegative().optional().describe('The first unit’s index'),
        to: z.number().int().nonnegative().optional().describe('The last unit’s index'),
      },
    },
    ({ site: s, election: e, source: sourceId, search, from, to }) =>
      run(async () => {
        const { source: found, units } = (await admin.get(
          `${electionPath(s, e)}/sources/${segment(sourceId)}`,
        )) as { source: { id: string; title: string; language: string | null }; units: Unit[] };
        const about = { id: found.id, title: found.title, language: found.language };
        if (search) {
          return { source: about, ...searchUnits(units, search) };
        }
        if (from !== undefined || to !== undefined) {
          return { source: about, ...readUnits(units, from ?? 0, to ?? Number.MAX_SAFE_INTEGER) };
        }
        return {
          source: about,
          units: units.map((unit) => ({ index: unit.index, label: unit.label })),
        };
      }),
  );

  server.registerTool(
    'start_cell',
    {
      title: 'Start a cell',
      description:
        'Creates a party’s cell on a criterion, an empty draft, once the member chose to draft it: the answer ' +
        'gives its version for the writes that follow.',
      inputSchema: { site, election, party, criterion },
    },
    ({ site: s, election: e, party: p, criterion: c }) =>
      run(async () => {
        const created = (await admin.send('POST', cellsPath(s, e), {
          partyId: p,
          criterionId: c,
        })) as { id: string };
        const draft = await draftOf(s, e, p, c);
        return { id: created.id, version: draft.contentVersion };
      }),
  );

  server.registerTool(
    'save_cell_draft',
    {
      title: 'Save a cell’s draft',
      description:
        'Sets a cell’s draft rating and its summary, the words the public reads beside the rating, which say only ' +
        'what its quotes or checked documents show. Its change kind and public note stay as they are: a person ' +
        'decides those. A rating other than "not_mentioned" needs quotes (add_quote); "not_mentioned" needs the ' +
        'party’s documents checked (add_checked_document).' +
        ACCEPTED,
      inputSchema: {
        site,
        election,
        party,
        criterion,
        version,
        rating: z
          .enum(RATINGS)
          .describe(
            'The rating, from the election’s scale: for demands, meets, partially_meets, does_not_meet or ' +
              'not_mentioned',
          ),
        summary: localized('The summary, as the member accepted it'),
      },
    },
    ({ site: s, election: e, party: p, criterion: c, version: v, rating, summary }) =>
      run(async () => {
        const draft = await editableDraft(s, e, p, c);
        return admin.send('PUT', `${cellsPath(s, e)}/${segment(draft.id)}`, {
          version: v,
          rating,
          summary,
          changeKind: draft.changeKind,
          publicNote: draft.publicNote,
        });
      }),
  );

  server.registerTool(
    'add_quote',
    {
      title: 'Add a quote',
      description:
        'Adds a quote to a cell’s draft: the source’s own words, copied exactly from read_source (15 to 1,000 ' +
        'characters), never reworded, shortened inside or joined from separate places. It is checked against the ' +
        'source’s text as the database checks it, and nothing that doesn’t match is added; only a PDF or a web ' +
        'page with its text takes one here (any other is attested by a person in the admin).' +
        ACCEPTED,
      inputSchema: {
        site,
        election,
        party,
        criterion,
        version,
        source,
        quote: z
          .string()
          .min(1)
          .max(MAX_QUOTE_LENGTH * 2),
        sectionLabel: z
          .string()
          .max(200)
          .nullable()
          .optional()
          .describe('Where it is, such as "p. 47"; by default, the pages it matched on'),
      },
    },
    ({
      site: s,
      election: e,
      party: p,
      criterion: c,
      version: v,
      source: from,
      quote,
      sectionLabel,
    }) =>
      run(async () => {
        const draft = await editableDraft(s, e, p, c);
        const { source: quoted, units } = (await admin.get(
          `${electionPath(s, e)}/sources/${segment(from)}`,
        )) as { source: { kind: string; extractionStatus: string }; units: Unit[] };
        // The database matches quotes only from these, with their text: any other is attested by a person (C4).
        if (!MATCHED_KINDS.has(quoted.kind) || quoted.extractionStatus !== 'done') {
          throw new ToolRefusal('notMatched', {
            kind: quoted.kind,
            extraction: quoted.extractionStatus,
          });
        }
        const match = matchQuote(quote, units);
        if (match.kind === 'too-short') {
          throw new ToolRefusal('tooShort', match);
        }
        if (match.kind === 'too-long') {
          throw new ToolRefusal('tooLong', match);
        }
        if (match.kind === 'unmatched') {
          throw new ToolRefusal('unmatched', match);
        }
        const { version: next } = (await admin.send(
          'POST',
          `${cellsPath(s, e)}/${segment(draft.id)}/quotes`,
          {
            version: v,
            sourceId: from,
            quote,
            sectionLabel: sectionLabel ?? match.span.location,
          },
        )) as { version: number };
        const after = await draftOf(s, e, p, c);
        // The last one: a quote goes after the others.
        const added = after.quotes.reduce<CellQuote | undefined>(
          (last, each) => (last && last.ordinal > each.ordinal ? last : each),
          undefined,
        );
        return { version: next, quote: added };
      }),
  );

  server.registerTool(
    'remove_quote',
    {
      title: 'Remove a quote',
      description:
        'Removes a quote from a cell’s draft, by its id as get_cell gives it.' + ACCEPTED,
      inputSchema: { site, election, party, criterion, version, quote: id('The quote’s id') },
    },
    ({ site: s, election: e, party: p, criterion: c, version: v, quote }) =>
      run(async () => {
        const draft = await editableDraft(s, e, p, c);
        return admin.send(
          'DELETE',
          `${cellsPath(s, e)}/${segment(draft.id)}/quotes/${segment(quote)}?version=${v}`,
        );
      }),
  );

  server.registerTool(
    'add_checked_document',
    {
      title: 'Add a checked document',
      description:
        'Records that a document of the party (its programme, say) was read through for a "not_mentioned" ' +
        'rating and says nothing on the criterion: only once its text was searched for the criterion’s words and ' +
        'their synonyms with read_source, and the member agreed it says nothing.' +
        ACCEPTED,
      inputSchema: { site, election, party, criterion, version, source },
    },
    ({ site: s, election: e, party: p, criterion: c, version: v, source: checked }) =>
      run(async () => {
        const draft = await editableDraft(s, e, p, c);
        return admin.send('POST', `${cellsPath(s, e)}/${segment(draft.id)}/checked`, {
          version: v,
          sourceId: checked,
        });
      }),
  );

  server.registerTool(
    'remove_checked_document',
    {
      title: 'Remove a checked document',
      description: 'Removes a document from those a cell’s draft records as checked.' + ACCEPTED,
      inputSchema: { site, election, party, criterion, version, source },
    },
    ({ site: s, election: e, party: p, criterion: c, version: v, source: checked }) =>
      run(async () => {
        const draft = await editableDraft(s, e, p, c);
        return admin.send(
          'DELETE',
          `${cellsPath(s, e)}/${segment(draft.id)}/checked/${segment(checked)}?version=${v}`,
        );
      }),
  );
};
