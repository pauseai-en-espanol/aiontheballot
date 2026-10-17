import { createDatabase } from '@aiontheballot/db/client';
import { createFileStore, type FileStore } from '@aiontheballot/db/file-store';
import Fastify, { type FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDataRoutes, TOKEN_ROUTES } from '../src/admin/routes.js';
import { ELECTIONS_A, USERS } from './fixtures.js';
import './db.js';

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.`);
  }
  return value;
};

const ORIGIN = 'https://admin.ejemplo.test';
const TOKEN_ID = '0190f8c4-0000-7000-8000-0000000000f1';
const admin = createDatabase({
  connectionString: env('TEST_ADMIN_DATABASE_URL'),
  maxConnections: 2,
});
const owner = createDatabase({
  connectionString: env('TEST_SUPERUSER_DATABASE_URL'),
  maxConnections: 1,
});
let root: string;
let files: FileStore;
let app: FastifyInstance;
/** Every route the admin's data scope registers, as `METHOD /pattern`. */
const routes: string[] = [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'token-routes-'));
  files = createFileStore(root);
  app = Fastify();
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD') {
        routes.push(`${method} ${route.url}`);
      }
    }
  });
  await app.register(
    adminDataRoutes({
      admin,
      files,
      adminOrigin: ORIGIN,
      // A token stands for the country admin of A here; whether a token stands for anyone is sign-in's (tested in
      // member-tokens.spec.ts). A session is the `x-test-user` header.
      actorFor: async (request) => {
        if (request.headers.authorization !== undefined) {
          return { userId: USERS.countryAdminA, aal: 2, tokenId: TOKEN_ID };
        }
        const user = request.headers['x-test-user'];
        return typeof user === 'string' ? { userId: user, aal: 2 } : undefined;
      },
    }),
    { prefix: '/api' },
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
  await Promise.all([admin.destroy(), owner.destroy()]);
});

/** A tool's request: the token, and never an Origin, which only browsers send. */
const asTool = (
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  contentType = 'application/json',
) =>
  app.inject({
    method,
    url,
    headers: {
      authorization: 'Bearer aiontheballot_de-ejemplo',
      ...(body === undefined ? {} : { 'content-type': contentType }),
    },
    ...(body === undefined ? {} : { payload: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  });

/** The header of a PNG of this size (all a logo's check reads), then fictional bytes, unique per call. */
const png = (width: number, height: number): Buffer => {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.from(`logotipo de ejemplo ${randomUUID()}`)]);
};

const party = (slug: string) => ({
  slug,
  name: { es: 'Partido de Ejemplo por Herramienta' },
  shortName: { es: 'PEH' },
  colour: '#123456',
  website: null,
  territoryCodes: null,
});

/** A path for a route's pattern, its parameters filled with fictional values. */
const pathOf = (pattern: string): string =>
  pattern.replaceAll(/:([a-z]+)/gi, (_, name: string) =>
    name === 'tenant' ? 'test-a' : name === 'election' ? ELECTIONS_A.draft.slug : randomUUID(),
  );

describe("a member's token, at the admin's routes (ADR-0008, PLAN R203)", () => {
  it('lists only routes that exist', () => {
    expect([...TOKEN_ROUTES].filter((route) => !routes.includes(route))).toEqual([]);
  });

  it('is refused by every other route, before anything is read', async () => {
    const others = routes.filter((route) => !TOKEN_ROUTES.has(route));
    expect(others.length).toBeGreaterThan(50);
    for (const route of others) {
      const [method, pattern] = route.split(' ') as ['GET' | 'POST' | 'PUT' | 'DELETE', string];
      const response = await asTool(method, pathOf(pattern), method === 'GET' ? undefined : {});
      expect([response.statusCode, response.json()], route).toEqual([
        403,
        { error: 'notForTokens' },
      ]);
    }
  });

  it("drafts an election's parties as its member, with no Origin, named as the token in the history", async () => {
    expect((await asTool('GET', '/api/tenants')).statusCode).toBe(200);
    expect((await asTool('HEAD', '/api/tenants')).statusCode).toBe(200);
    const parties = `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/parties`;
    const created = await asTool('POST', parties, party(`partido-${randomUUID().slice(0, 8)}`));
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const edited = await asTool('PUT', `${parties}/${id}`, {
      ...party(`partido-${randomUUID().slice(0, 8)}`),
      colour: '#654321',
    });
    expect(edited.statusCode).toBe(204);
    const logo = await asTool(
      'PUT',
      `${parties}/${id}/logo?filename=logo.png`,
      png(64, 64),
      'image/png',
    );
    expect(logo.statusCode).toBe(201);
    const listed = await asTool('GET', parties);
    const ids = listed.json<{ parties: { id: string }[] }>().parties.map((p) => p.id);
    expect(ids).toContain(id);
    expect(
      (await asTool('PUT', `${parties}/order`, { shown: ids, ids: [...ids].reverse() })).statusCode,
    ).toBe(204);
    // The request's token reached the database: the history names it, beside its member.
    const { rows } = await sql<{ token_id: string | null; actor_id: string }>`
      SELECT token_id, actor_id FROM app.audit_log
       WHERE table_name = 'parties' AND row_id = ${id} AND action = 'insert'`.execute(owner);
    expect(rows).toEqual([{ token_id: TOKEN_ID, actor_id: USERS.countryAdminA }]);
  });

  it("drafts an election's criteria, never deleting one (PLAN R213)", async () => {
    const criteria = `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/criteria`;
    const criterion = (slug: string) => ({
      slug,
      title: { es: 'Criterio de ejemplo de la herramienta' },
      shortTitle: { es: 'Ejemplo' },
      description: { es: 'Descripción de ejemplo de la herramienta' },
      coreCriterionId: null,
    });
    const created = await asTool(
      'POST',
      criteria,
      criterion(`criterio-${randomUUID().slice(0, 8)}`),
    );
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    expect(
      (
        await asTool('PUT', `${criteria}/${id}`, {
          ...criterion(`criterio-${randomUUID().slice(0, 8)}`),
          title: { es: 'Criterio de ejemplo renombrado' },
        })
      ).statusCode,
    ).toBe(204);
    const listed = await asTool('GET', criteria);
    const ids = listed.json<{ criteria: { id: string }[] }>().criteria.map((c) => c.id);
    expect(ids).toContain(id);
    expect(
      (await asTool('PUT', `${criteria}/order`, { shown: ids, ids: [...ids].reverse() }))
        .statusCode,
    ).toBe(204);
    const deleted = await asTool('DELETE', `${criteria}/${id}`);
    expect([deleted.statusCode, deleted.json()]).toEqual([403, { error: 'notForTokens' }]);
    const { rows } = await sql<{ token_id: string | null }>`
      SELECT token_id FROM app.audit_log
       WHERE table_name = 'criteria' AND row_id = ${id} AND action = 'insert'`.execute(owner);
    expect(rows).toEqual([{ token_id: TOKEN_ID }]);
  });

  it('creates an election, always a draft', async () => {
    const made = await asTool('POST', '/api/t/test-a/elections', {
      slug: `elecciones-${randomUUID().slice(0, 8)}`,
      type: 'general',
      territoryCode: null,
      name: { es: 'Elecciones de ejemplo por herramienta' },
      date: '2030-10-04',
    });
    expect(made.statusCode).toBe(201);
  });

  it("can't edit a live election's party directly: the database asks for an approved change", async () => {
    const response = await asTool(
      'PUT',
      `/api/t/test-a/e/${ELECTIONS_A.live.slug}/parties/${ELECTIONS_A.live.parties[1]}`,
      party('partido-ejemplo-b'),
    );
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('is refused a change applied at once, which is approving it', async () => {
    const response = await asTool('POST', `/api/t/test-a/e/${ELECTIONS_A.live.slug}/changes`, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTIONS_A.live.parties[1],
      field: 'short_name',
      value: { es: 'PE-B' },
      publicNote: { es: 'Nota pública de ejemplo' },
      apply: true,
    });
    expect([response.statusCode, response.json()]).toEqual([403, { error: 'notForTokens' }]);
  });

  it('proposes a change to a live election, and withdraws it', async () => {
    const changes = `/api/t/test-a/e/${ELECTIONS_A.live.slug}/changes`;
    const proposed = await asTool('POST', changes, {
      action: 'update',
      targetKind: 'party',
      targetId: ELECTIONS_A.live.parties[1],
      field: 'short_name',
      value: { es: 'PE-B' },
      publicNote: { es: 'Nota pública de ejemplo' },
    });
    expect(proposed.statusCode).toBe(201);
    const { id } = proposed.json<{ id: string }>();
    expect((await asTool('DELETE', `${changes}/${id}`)).statusCode).toBe(204);
  });

  it("still asks a member's own session for the admin's Origin on a write", async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/t/test-a/e/${ELECTIONS_A.empty.slug}/parties`,
      headers: { 'x-test-user': USERS.countryAdminA, 'content-type': 'application/json' },
      payload: JSON.stringify({
        slug: 'partido-sin-origen',
        name: { es: 'Partido sin origen' },
        shortName: { es: 'PSO' },
        colour: null,
        website: null,
        territoryCodes: null,
      }),
    });
    expect([response.statusCode, response.json()]).toEqual([403, { error: 'forbidden' }]);
  });
});
