import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';

import { type AdminClient, AdminError } from './admin-client.js';
import { registerTools } from './tools.js';

const PARTY = '0190f8c4-0000-7000-8000-000000000721';

/** A fictional party of a draft election, as the admin lists it. */
const listed = {
  parties: [
    {
      id: PARTY,
      slug: 'partido-ejemplo-a',
      name: { es: 'Partido Ejemplo A' },
      shortName: { es: 'PEA' },
      colour: null,
      website: null,
      territoryCodes: null,
    },
  ],
};

const CRITERION = '0190f8c4-0000-7000-8000-000000000821';
/** A core criterion a person linked it to, which a tool's update keeps. */
const CORE = '0190f8c4-0000-7000-8000-000000000990';

/** A fictional criterion of a draft election, as the admin lists it. */
const listedCriteria = {
  criteria: [
    {
      id: CRITERION,
      slug: 'criterio-de-ejemplo',
      title: { es: 'Criterio de ejemplo' },
      shortTitle: { es: 'Ejemplo' },
      description: { es: 'Descripción de ejemplo' },
      displayOrder: 1,
      coreCriterionId: CORE,
      retired: false,
    },
  ],
  coreCriteria: [],
  canEdit: true,
};

/** An MCP client talking to the tools, over the admin `admin`, whose calls are recorded. */
const connected = async (admin: Partial<AdminClient>) => {
  const calls: unknown[][] = [];
  const recorder: AdminClient = {
    get: async (...args) => {
      calls.push(['GET', ...args]);
      return admin.get?.(...args);
    },
    send: async (...args) => {
      calls.push(args);
      return admin.send?.(...args);
    },
    upload: async (...args) => {
      calls.push(['UPLOAD', ...args]);
      return admin.upload?.(...args);
    },
  };
  const server = new McpServer({ name: 'prueba', version: '0.0.0' });
  registerTools(server, recorder);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'cliente-de-prueba', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, calls };
};

const text = (result: unknown) =>
  JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as unknown;

describe('the tools (PLAN R204)', () => {
  it('are the routes a token may reach: reading, and drafting an election’s parties, criteria and cells', async () => {
    const { client } = await connected({});
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      'add_checked_document',
      'add_quote',
      'create_criterion',
      'create_election',
      'create_party',
      'get_cell',
      'get_election',
      'list_cells',
      'list_changes',
      'list_criteria',
      'list_elections',
      'list_parties',
      'list_sites',
      'list_sources',
      'propose_change',
      'read_source',
      'remove_checked_document',
      'remove_quote',
      'reorder_criteria',
      'reorder_parties',
      'save_cell_draft',
      'set_party_logo',
      'start_cell',
      'update_criterion',
      'update_party',
      'withdraw_change',
    ]);
    // A cell is drafted, never taken through review or decided (PLAN R232).
    expect(
      names.filter((name) => /submit|recall|reject|publish|attest|recheck|delete/.test(name)),
    ).toEqual([]);
  });

  it('create a criterion in the words given, never linked to a core criterion (PLAN R213)', async () => {
    const { client, calls } = await connected({ send: async () => ({ id: CRITERION }) });
    await client.callTool({
      name: 'create_criterion',
      arguments: {
        site: 'ejemplo-a',
        election: 'autonomicas',
        slug: 'criterio-nuevo',
        title: { es: 'Criterio nuevo de ejemplo' },
        shortTitle: { es: 'Nuevo' },
        description: { es: 'Descripción de ejemplo' },
      },
    });
    expect(calls.at(-1)).toEqual([
      'POST',
      '/api/t/ejemplo-a/e/autonomicas/criteria',
      {
        slug: 'criterio-nuevo',
        title: { es: 'Criterio nuevo de ejemplo' },
        shortTitle: { es: 'Nuevo' },
        description: { es: 'Descripción de ejemplo' },
        coreCriterionId: null,
      },
    ]);
  });

  it('update a criterion’s fields given, keeping the others and its core criterion', async () => {
    const { client, calls } = await connected({ get: async () => listedCriteria });
    await client.callTool({
      name: 'update_criterion',
      arguments: {
        site: 'ejemplo-a',
        election: 'autonomicas',
        criterion: CRITERION,
        title: { es: 'Criterio de ejemplo bis' },
      },
    });
    expect(calls.at(-1)).toEqual([
      'PUT',
      `/api/t/ejemplo-a/e/autonomicas/criteria/${CRITERION}`,
      {
        slug: 'criterio-de-ejemplo',
        title: { es: 'Criterio de ejemplo bis' },
        shortTitle: { es: 'Ejemplo' },
        description: { es: 'Descripción de ejemplo' },
        coreCriterionId: CORE,
      },
    ]);
  });

  it('update a party’s fields given, keeping the others, with its colour in lower case', async () => {
    const { client, calls } = await connected({ get: async () => listed });
    await client.callTool({
      name: 'update_party',
      arguments: { site: 'ejemplo-a', election: 'autonomicas', party: PARTY, colour: '#ABCDEF' },
    });
    expect(calls.at(-1)).toEqual([
      'PUT',
      `/api/t/ejemplo-a/e/autonomicas/parties/${PARTY}`,
      {
        slug: 'partido-ejemplo-a',
        name: { es: 'Partido Ejemplo A' },
        shortName: { es: 'PEA' },
        colour: '#abcdef',
        website: null,
        territoryCodes: null,
      },
    ]);
  });

  it('say why the admin refused, in words a tool can act on', async () => {
    const { client } = await connected({
      send: async () => {
        throw new AdminError(403, 'notForTokens');
      },
    });
    const result = await client.callTool({
      name: 'withdraw_change',
      arguments: { site: 'ejemplo-a', election: 'generales', change: PARTY },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatchObject({ status: 403, error: 'notForTokens' });
  });

  it('take a site and an election only by short name, so no name reaches another route', async () => {
    const { client, calls } = await connected({ get: async () => ({}) });
    for (const [s, e] of [
      ['..', 'generales'],
      ['ejemplo-a', '..'],
      ['ejemplo-a', 'a/b'],
      ['ejemplo-a?x=1', 'generales'],
    ]) {
      const result = await client.callTool({
        name: 'list_parties',
        arguments: { site: s, election: e },
      });
      expect(result.isError, `${s} ${e}`).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it('propose changes to parties and the election, never to criteria or the methodology', async () => {
    const { client, calls } = await connected({ send: async () => ({}) });
    const result = await client.callTool({
      name: 'propose_change',
      arguments: {
        site: 'ejemplo-a',
        election: 'generales',
        action: 'update',
        targetKind: 'criterion',
        targetId: PARTY,
        field: 'title',
        value: { es: 'Otro título' },
        publicNote: { es: 'Nota de ejemplo' },
      },
    });
    expect(result.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  describe('a cell’s draft (PLAN R232)', () => {
    const CELL = '0190f8c4-0000-7000-8000-000000000951';
    const SOURCE = '0190f8c4-0000-7000-8000-000000000961';
    const at = '/api/t/ejemplo-a/e/autonomicas';
    const where = {
      site: 'ejemplo-a',
      election: 'autonomicas',
      party: PARTY,
      criterion: CRITERION,
    };
    /** A fictional cell's draft, with a public note a person wrote, as the admin shows it. */
    const cell = (quotes: unknown[] = []) => ({
      party: { id: PARTY },
      criterion: { id: CRITERION },
      draft: {
        id: CELL,
        state: 'draft',
        contentVersion: 7,
        rating: null,
        summary: null,
        changeKind: 'update',
        publicNote: { es: 'Nota pública de ejemplo' },
        quotes,
        checkedDocuments: [],
      },
      revisions: [],
      sources: [],
      names: { '0190f8c4-0000-7000-8000-000000000102': 'Persona de Ejemplo' },
      you: '0190f8c4-0000-7000-8000-000000000102',
    });
    /** The fictional source's text, by page. */
    const source = {
      source: {
        id: SOURCE,
        title: 'Programa de ejemplo',
        language: 'es',
        kind: 'pdf',
        extractionStatus: 'done',
      },
      units: [
        { index: 0, label: 'p. 1', body: 'Portada del programa de ejemplo.' },
        { index: 1, label: 'p. 2', body: 'Proponemos una agencia de evalua-\nción de ejemplo.' },
      ],
    };
    const get = async (path: string) => (path.includes('/sources/') ? source : cell());

    it('shows a cell without the names of the people its trail names', async () => {
      const { client, calls } = await connected({ get });
      const shown = text(await client.callTool({ name: 'get_cell', arguments: where }));
      expect(calls).toEqual([['GET', `${at}/cells/${PARTY}/${CRITERION}`]]);
      expect(shown).toMatchObject({ draft: { id: CELL, contentVersion: 7 } });
      expect(shown).not.toHaveProperty('names');
      expect(shown).not.toHaveProperty('you');
    });

    it('saves the rating and summary given at the version given, the change kind and public note as they are', async () => {
      const { client, calls } = await connected({ get, send: async () => ({ version: 8 }) });
      const result = await client.callTool({
        name: 'save_cell_draft',
        // The version the member's tool last read, not the one it reads now: a change since is refused.
        arguments: { ...where, version: 6, rating: 'meets', summary: { es: 'Resumen de ejemplo' } },
      });
      expect(text(result)).toEqual({ version: 8 });
      expect(calls.at(-1)).toEqual([
        'PUT',
        `${at}/cells/${CELL}`,
        {
          version: 6,
          rating: 'meets',
          summary: { es: 'Resumen de ejemplo' },
          changeKind: 'update',
          publicNote: { es: 'Nota pública de ejemplo' },
        },
      ]);
    });

    it('says to start a cell that doesn’t exist yet, and writes nothing', async () => {
      const { client, calls } = await connected({ get: async () => ({ ...cell(), draft: null }) });
      const result = await client.callTool({
        name: 'save_cell_draft',
        arguments: { ...where, version: 0, rating: 'meets', summary: { es: 'Resumen de ejemplo' } },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatchObject({ error: 'noCell' });
      expect(calls.filter(([method]) => method !== 'GET')).toEqual([]);
    });

    it('adds a quote that matches the source as it reads, labelled with the page it matched on', async () => {
      const added = {
        id: 'q',
        ordinal: 1,
        quote: 'Proponemos una agencia de evaluación',
        matchStatus: 'matched',
      };
      let reads = 0;
      const { client, calls } = await connected({
        get: async (path) => {
          if (path.includes('/sources/')) {
            return source;
          }
          reads += 1;
          return reads === 1 ? cell() : cell([added]);
        },
        send: async () => ({ version: 8 }),
      });
      const result = await client.callTool({
        name: 'add_quote',
        arguments: {
          ...where,
          version: 7,
          source: SOURCE,
          quote: 'Proponemos una agencia de evaluación',
        },
      });
      expect(text(result)).toEqual({ version: 8, quote: added });
      expect(calls).toContainEqual([
        'POST',
        `${at}/cells/${CELL}/quotes`,
        {
          version: 7,
          sourceId: SOURCE,
          quote: 'Proponemos una agencia de evaluación',
          sectionLabel: 'p. 2',
        },
      ]);
    });

    it('refuses a quote the source doesn’t have, saying how much of it it has, and adds nothing', async () => {
      const { client, calls } = await connected({ get, send: async () => ({ version: 8 }) });
      const result = await client.callTool({
        name: 'add_quote',
        arguments: {
          ...where,
          version: 7,
          source: SOURCE,
          quote: 'Proponemos una agencia de supervisión',
        },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatchObject({
        error: 'unmatched',
        detail: {
          kind: 'unmatched',
          longest: { part: 'start', text: 'Proponemos una agencia de ' },
        },
      });
      expect(calls.filter(([method]) => method !== 'GET')).toEqual([]);
    });

    it('refuses a quote from a source the database doesn’t match, which a person attests instead', async () => {
      const submitted = { ...source, source: { ...source.source, kind: 'party_submission' } };
      const { client, calls } = await connected({
        get: async (path) => (path.includes('/sources/') ? submitted : cell()),
        send: async () => ({ version: 8 }),
      });
      const result = await client.callTool({
        name: 'add_quote',
        arguments: {
          ...where,
          version: 7,
          source: SOURCE,
          quote: 'Proponemos una agencia de evaluación',
        },
      });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatchObject({
        error: 'notMatched',
        detail: { kind: 'party_submission' },
      });
      expect(calls.filter(([method]) => method !== 'GET')).toEqual([]);
    });

    it('records and removes a checked document, and removes a quote, at the version given', async () => {
      const { client, calls } = await connected({ get, send: async () => ({ version: 8 }) });
      await client.callTool({
        name: 'add_checked_document',
        arguments: { ...where, version: 7, source: SOURCE },
      });
      await client.callTool({
        name: 'remove_checked_document',
        arguments: { ...where, version: 8, source: SOURCE },
      });
      await client.callTool({
        name: 'remove_quote',
        arguments: { ...where, version: 9, quote: SOURCE },
      });
      expect(calls.filter(([method]) => method !== 'GET')).toEqual([
        ['POST', `${at}/cells/${CELL}/checked`, { version: 7, sourceId: SOURCE }],
        ['DELETE', `${at}/cells/${CELL}/checked/${SOURCE}?version=8`],
        ['DELETE', `${at}/cells/${CELL}/quotes/${SOURCE}?version=9`],
      ]);
    });

    it('searches a source, or reads some of its pages', async () => {
      const { client } = await connected({ get });
      expect(
        text(
          await client.callTool({
            name: 'read_source',
            arguments: { ...where, source: SOURCE, search: ['EVALUACION'] },
          }),
        ),
      ).toMatchObject({
        found: 1,
        passages: [{ label: 'p. 2', text: 'Proponemos una agencia de evaluación de ejemplo.' }],
      });
      expect(
        text(
          await client.callTool({
            name: 'read_source',
            arguments: { ...where, source: SOURCE, from: 0, to: 0 },
          }),
        ),
      ).toMatchObject({
        units: [{ label: 'p. 1', text: 'Portada del programa de ejemplo.' }],
        next: null,
      });
      expect(
        text(
          await client.callTool({ name: 'read_source', arguments: { ...where, source: SOURCE } }),
        ),
      ).toMatchObject({
        units: [
          { index: 0, label: 'p. 1' },
          { index: 1, label: 'p. 2' },
        ],
      });
    });
  });
});
