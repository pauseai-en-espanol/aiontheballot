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
  it('are the routes a token may reach: reading, and drafting an election’s parties and criteria', async () => {
    const { client } = await connected({});
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
      'create_criterion',
      'create_election',
      'create_party',
      'get_election',
      'list_changes',
      'list_criteria',
      'list_elections',
      'list_parties',
      'list_sites',
      'propose_change',
      'reorder_criteria',
      'reorder_parties',
      'set_party_logo',
      'update_criterion',
      'update_party',
      'withdraw_change',
    ]);
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
});
