import { messages } from '@aiontheballot/i18n/messages';
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { addMembership, createTenant, deleteAccounts, purgeTenant } from '../accounts.js';
import { signedInAccount } from '../admin.js';
import { ADMIN_URL } from '../servers.js';
import { expect, test } from '../test.js';

const en = messages.en;
const SERVER = createRequire(import.meta.url).resolve('@aiontheballot/mcp/dist/main.js');

const created: string[] = [];
test.afterAll(async () => {
  await deleteAccounts(created.splice(0));
});

/**
 * The MCP server as an AI tool starts it (PLAN R204), over stdio, with the admin's address and the token in its
 * environment and nothing else of the test's: JSON-RPC, a message a line.
 */
const mcp = (token: string, logos: string) => {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH ?? '',
      AIONTHEBALLOT_ADMIN_URL: ADMIN_URL,
      AIONTHEBALLOT_TOKEN: token,
      AIONTHEBALLOT_LOGO_DIR: logos,
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const waiting = new Map<
    number,
    { resolve: (message: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  const failAll = (why: string) => {
    for (const { reject } of waiting.values()) {
      reject(new Error(`${why}${stderr === '' ? '' : `: ${stderr}`}`));
    }
    waiting.clear();
  };
  child.on('exit', (code) => failAll(`The MCP server stopped (${String(code)})`));
  createInterface({ input: child.stdout }).on('line', (line) => {
    // Stdout is the protocol's alone: anything else on it is a fault.
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      failAll(`The MCP server wrote something that isn't JSON-RPC on stdout: ${line}`);
      return;
    }
    if (typeof message['id'] === 'number') {
      waiting.get(message['id'])?.resolve(message);
      waiting.delete(message['id']);
    }
  });
  let next = 0;
  const request = (method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      next += 1;
      const id = next;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`No answer to ${method}${stderr === '' ? '' : `: ${stderr}`}`));
      }, 10_000);
      waiting.set(id, {
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  /** A tool's answer: what the admin answered, as JSON, and whether it was a refusal. */
  const call = async (name: string, args: Record<string, unknown>) => {
    const { result } = (await request('tools/call', { name, arguments: args })) as {
      result: { isError?: boolean; content: { text: string }[] };
    };
    return {
      refused: result.isError === true,
      // The admin's answer as JSON; a refusal on this machine (a file that isn't a logo) in words.
      body: ((text: string) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })(result.content[0]!.text),
    };
  };
  return {
    start: async () => {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '0.0.0' },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
    },
    call,
    stop: () => child.kill(),
  };
};

/** The header of a PNG (all a logo's check reads), then fictional bytes. */
const png = (): Buffer => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(64, 16);
  header.writeUInt32BE(64, 20);
  return Buffer.concat([header, Buffer.from(`logotipo de ejemplo ${randomUUID()}`)]);
};

test.describe('the MCP server, on a member’s machine (ADR-0008, PLAN R204)', () => {
  test('drafts an election, its party and the party’s logo as the member, and keeps an SVG on the machine', async ({
    page,
  }) => {
    const member = await signedInAccount(page, created, 'Persona con asistente de ejemplo');
    const site = await createTenant();
    const folder = await mkdtemp(join(tmpdir(), 'mcp-'));
    try {
      await addMembership(member.id, site.slug, 'country_admin');
      await page.goto(`${ADMIN_URL}/tokens`);
      await page.getByLabel(en.admin.tokens.name).fill('Asistente de ejemplo');
      await page.getByRole('button', { name: en.admin.tokens.submit }).click();
      const token = await page.getByLabel(en.admin.tokens.yours).inputValue();

      const server = mcp(token, folder);
      try {
        await server.start();
        const sites = await server.call('list_sites', {});
        expect(sites.body).toMatchObject({ tenants: [{ slug: site.slug }] });

        const election = await server.call('create_election', {
          site: site.slug,
          slug: 'elecciones-de-ejemplo',
          type: 'general',
          name: { es: 'Elecciones de ejemplo' },
          date: '2030-10-04',
          territoryCode: null,
        });
        expect(election.refused).toBe(false);

        const party = await server.call('create_party', {
          site: site.slug,
          election: 'elecciones-de-ejemplo',
          slug: 'partido-ejemplo-a',
          name: { es: 'Partido Ejemplo A' },
          shortName: { es: 'PEA' },
          colour: '#1A2B3C',
          website: null,
          territoryCodes: null,
        });
        expect(party.refused).toBe(false);
        const { id } = party.body as { id: string };

        const logo = join(folder, 'logo.png');
        await writeFile(logo, png());
        const uploaded = await server.call('set_party_logo', {
          site: site.slug,
          election: 'elecciones-de-ejemplo',
          party: id,
          file: logo,
        });
        expect(uploaded.refused).toBe(false);

        const listed = await server.call('list_parties', {
          site: site.slug,
          election: 'elecciones-de-ejemplo',
        });
        expect(listed.body).toMatchObject({
          parties: [{ id, slug: 'partido-ejemplo-a', colour: '#1a2b3c', logo: expect.anything() }],
        });

        // An SVG never leaves the machine.
        const svg = join(folder, 'logo.svg');
        await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
        expect(
          await server.call('set_party_logo', {
            site: site.slug,
            election: 'elecciones-de-ejemplo',
            party: id,
            file: svg,
          }),
        ).toMatchObject({ refused: true, body: expect.stringContaining('PNG') });
      } finally {
        server.stop();
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
      await purgeTenant(site.id);
    }
  });
});
