import type { Actor } from '@aiontheballot/db/actor';
import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';

import { withActor } from '@aiontheballot/db/actor';
import { captureException } from '@sentry/node';

import type { ProfileSource } from './profiles.js';

import { databaseRefusal } from '../database-errors.js';
import { type Access, accessTo, holds, isPlatformAdmin, TENANT_ROLES } from './access.js';
import { addRole, listMemberships, removeRole } from './members.js';
import { listTenants, tenantOverview } from './tenants.js';

/**
 * What the API refuses on its own, before or after the database has its say (editorial workflow §2.3): each a key
 * under `errors` in packages/i18n, like the database's refusals (database-errors.ts).
 */
export const API_REFUSAL_KEYS = ['notFound', 'lastCountryAdmin', 'notMember'] as const;
export type ApiRefusalKey = (typeof API_REFUSAL_KEYS)[number];

/**
 * Thrown inside a route's `withActor` transaction to refuse the request and roll back whatever it wrote, as the last
 * country admin's removal is.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    readonly key: ApiRefusalKey | 'forbidden',
  ) {
    super(key);
  }
}

const SLUG = { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 } as const;
const UUID = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
} as const;
const ROLE = { type: 'string', enum: TENANT_ROLES } as const;

const TENANT_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG },
  required: ['tenant'],
} as const;
const MEMBER_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, userId: UUID },
  required: ['tenant', 'userId'],
} as const;
const MEMBER_ROLE_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, userId: UUID, role: ROLE },
  required: ['tenant', 'userId', 'role'],
} as const;

type TenantRole = (typeof TENANT_ROLES)[number];

export interface AdminDataOptions {
  /** The aiontheballot_admin role's pool; without it every route here answers 503. */
  admin?: Database;
  /** Names and emails, from Better Auth's tables; without it the members route answers 503. */
  profiles?: ProfileSource;
  /** The admin's origin: a write must come from a page on it. */
  adminOrigin: string;
  /** Who a request acts for: a signed-in actor at aal2, or nobody (auth/session.ts). */
  actorFor: (request: FastifyRequest) => Promise<Actor | undefined>;
}

/** The tenant the path names, or a 404 for one RLS hides (editorial workflow §2.1). */
const tenantFor = async (trx: Transaction<DB>, actor: Actor, slug: string): Promise<Access> => {
  const access = await accessTo(trx, actor.userId, slug);
  if (!access) {
    throw new Refusal(404, 'notFound');
  }
  return access;
};

/**
 * The signed-in data routes under `/api` (ADR-0003 §1): every read and write runs in one `withActor` transaction as
 * aiontheballot_admin, so RLS and the triggers decide (ADR-0002 §3); what the routes check besides only shapes the
 * answer.
 */
export const adminDataRoutes =
  ({ admin, profiles, adminOrigin, actorFor }: AdminDataOptions) =>
  async (scope: FastifyInstance): Promise<void> => {
    /**
     * Runs `run` for the signed-in actor. A write must come from a page on the admin's origin, which every browser
     * names in `Origin` on such requests: with SameSite=Lax cookies and JSON-only bodies, a cross-site page can't
     * send one with the session anyway, and this refuses it outright. A refusal, the API's or the database's, becomes
     * its answer (§2.3); anything else is a fault, reported without the request's body.
     */
    const signedIn = async (
      request: FastifyRequest,
      reply: FastifyReply,
      run: (db: Database, actor: Actor) => Promise<unknown>,
    ): Promise<unknown> => {
      if (!admin) {
        return reply.code(503).send({ error: 'Admin data is not configured' });
      }
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      if (request.method !== 'GET' && request.headers.origin !== adminOrigin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        return await run(admin, actor);
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.status).send({ error: error.key });
        }
        const refusal = databaseRefusal(error);
        if (refusal.report) {
          // A database error is reported by its SQLSTATE and where it came from, never its message, which can quote
          // what was written; anything else (a bug in the API) as it is.
          const { code, routine } = (error ?? {}) as { code?: unknown; routine?: unknown };
          request.log.error(
            { code, routine, constraint: refusal.constraint },
            'Admin request failed',
          );
          captureException(
            typeof code === 'string'
              ? new Error(`Admin request failed: SQLSTATE ${code} in ${String(routine)}`)
              : error,
          );
        }
        return reply.code(refusal.status).send({
          error: refusal.error,
          ...(refusal.constraint === undefined ? {} : { constraint: refusal.constraint }),
        });
      }
    };

    // The tenants the user may open, and whether they may open any (A6: a platform admin lands on the list).
    scope.get('/tenants', async (request, reply) =>
      signedIn(request, reply, (db, actor) =>
        withActor(db, actor, async (trx) => ({
          tenants: await listTenants(trx),
          platformAdmin: await isPlatformAdmin(trx, actor.userId),
        })),
      ),
    );

    // A tenant's screen header and settings, with what the actor holds there.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) =>
            tenantOverview(trx, await tenantFor(trx, actor, request.params.tenant)),
          ),
        ),
    );

    // The tenant's members (A7.1): names and roles to every member, emails to country and platform admins only.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/members',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!profiles) {
            return reply.code(503).send({ error: 'Member profiles are not configured' });
          }
          const { access, memberships } = await withActor(db, actor, async (trx) => {
            const found = await tenantFor(trx, actor, request.params.tenant);
            return { access: found, memberships: await listMemberships(trx, found.tenantId) };
          });
          const manager = holds(access, 'country_admin');
          const found = await profiles(
            memberships.map((m) => m.userId),
            { emails: manager },
          );
          const members = memberships.map(({ userId, roles }) => ({
            userId,
            name: found.get(userId)?.name ?? null,
            ...(manager ? { email: found.get(userId)?.email ?? null } : {}),
            roles,
          }));
          members.sort(
            (a, b) =>
              (a.name ?? '').localeCompare(b.name ?? '') || a.userId.localeCompare(b.userId),
          );
          return { members, canManage: manager, emailsShown: manager };
        }),
    );

    // Gives an existing member another role (A7.2).
    scope.post<{ Params: { tenant: string; userId: string }; Body: { role: TenantRole } }>(
      '/t/:tenant/members/:userId/roles',
      {
        schema: {
          params: MEMBER_PARAMS,
          body: {
            type: 'object',
            properties: { role: ROLE },
            required: ['role'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const result = await addRole(trx, tenantId, request.params.userId, request.body.role);
            if (result === 'not-member') {
              throw new Refusal(409, 'notMember');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Removes a role (A7.2), never the tenant's last country admin (A7.4).
    scope.delete<{ Params: { tenant: string; userId: string; role: TenantRole } }>(
      '/t/:tenant/members/:userId/roles/:role',
      { schema: { params: MEMBER_ROLE_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const result = await removeRole(
              trx,
              tenantId,
              request.params.userId,
              request.params.role,
            );
            if (result === 'not-found') {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'forbidden') {
              throw new Refusal(403, 'forbidden');
            }
            if (result === 'last-country-admin') {
              throw new Refusal(409, 'lastCountryAdmin');
            }
          });
          return reply.code(204).send();
        }),
    );
  };
