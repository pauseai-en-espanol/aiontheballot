import type { Actor } from '@aiontheballot/db/actor';
import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';

import { withActor } from '@aiontheballot/db/actor';
import { captureException } from '@sentry/node';

import type { ProfileSource } from './profiles.js';

import { databaseRefusal } from '../database-errors.js';
import { type Access, accessTo, holds, isPlatformAdmin, TENANT_ROLES } from './access.js';
import { localizedInput, localizedSchema } from './localized-input.js';
import { addRole, listMemberships, removeRole } from './members.js';
import {
  type ChangeResult,
  createDocument,
  deleteDocument,
  DOCUMENT_KINDS,
  type DocumentKind,
  listDocuments,
  updateDocument,
  updateSettings,
} from './settings.js';
import { listTenants, tenantOverview } from './tenants.js';

/**
 * What the API refuses on its own, before or after the database has its say (editorial workflow §2.3): each a key
 * under `errors` in packages/i18n, like the database's refusals (database-errors.ts).
 */
export const API_REFUSAL_KEYS = [
  'notFound',
  'lastCountryAdmin',
  'notMember',
  'draftExists',
  'needsDefaultLanguage',
] as const;
export type ApiRefusalKey = (typeof API_REFUSAL_KEYS)[number];

/**
 * Thrown inside a route's `withActor` transaction to refuse the request and roll back whatever it wrote, as the last
 * country admin's removal is.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422,
    readonly key: ApiRefusalKey | 'forbidden' | 'invalid' | 'incomplete' | 'stale',
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
const ID_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, id: UUID },
  required: ['tenant', 'id'],
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

/** A policy text's length in one language at most: long enough for a privacy policy. */
const DOCUMENT_MAX_LENGTH = 100_000;

/** Turns a write that changed nothing into its refusal (each data function says why). */
const refuseUnless = (result: ChangeResult): void => {
  if (result === 'not-found') {
    throw new Refusal(404, 'notFound');
  }
  if (result === 'forbidden') {
    throw new Refusal(403, 'forbidden');
  }
  if (result === 'stale') {
    throw new Refusal(409, 'stale');
  }
};

/** Localized text a column requires: in the tenant's languages only, and with text in at least one. */
const requiredLocalized = (value: Record<string, string>, access: Access): Localized => {
  const input = localizedInput(value, access.enabledLocales);
  if (input === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  if (input === 'empty') {
    throw new Refusal(422, 'incomplete');
  }
  return input;
};

/**
 * Text that is to be published must have the tenant's default language (the trigger's rule too, which names nothing):
 * this says so, so the admin can point at that language (editorial workflow §2.3).
 */
const publishable = (body: Localized, access: Access, publish: boolean): Localized => {
  if (publish && !Object.hasOwn(body, access.defaultLocale)) {
    throw new Refusal(422, 'needsDefaultLanguage');
  }
  return body;
};

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

    // A tenant's settings (T3, P1): the report retention, and whether live edits need a second approver.
    scope.patch<{
      Params: { tenant: string };
      Body: { reportRetentionDays?: number; liveEditsNeedSecondApprover?: boolean };
    }>(
      '/t/:tenant/settings',
      {
        schema: {
          params: TENANT_PARAMS,
          body: {
            type: 'object',
            properties: {
              // A century at most: the column takes any positive integer, and a typo shouldn't keep reports forever.
              reportRetentionDays: { type: 'integer', minimum: 1, maximum: 36_500 },
              liveEditsNeedSecondApprover: { type: 'boolean' },
            },
            additionalProperties: false,
            minProperties: 1,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const { reportRetentionDays, liveEditsNeedSecondApprover } = request.body;
            // Fastify drops properties the schema doesn't name, so a body of only those arrives empty.
            if (reportRetentionDays === undefined && liveEditsNeedSecondApprover === undefined) {
              throw new Refusal(400, 'invalid');
            }
            refuseUnless(
              await updateSettings(trx, tenantId, {
                reportRetentionDays,
                liveEditsNeedSecondApprover,
              }),
            );
          });
          return reply.code(204).send();
        }),
    );

    // The operator's texts (T2): every version, for every member.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/documents',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              documents: await listDocuments(trx, access.tenantId),
              canEdit: holds(access, 'country_admin'),
            };
          }),
        ),
    );

    // Starts a version of a text: a draft, or published at once.
    scope.post<{
      Params: { tenant: string };
      Body: { kind: DocumentKind; body: Record<string, string>; publish?: boolean };
    }>(
      '/t/:tenant/documents',
      {
        schema: {
          params: TENANT_PARAMS,
          body: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: DOCUMENT_KINDS },
              body: localizedSchema(DOCUMENT_MAX_LENGTH),
              publish: { type: 'boolean' },
            },
            required: ['kind', 'body'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const created = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            const result = await createDocument(
              trx,
              access.tenantId,
              request.body.kind,
              publishable(
                requiredLocalized(request.body.body, access),
                access,
                request.body.publish === true,
              ),
              request.body.publish === true,
            );
            if (result === 'draft-exists') {
              throw new Refusal(409, 'draftExists');
            }
            if (result === 'forbidden') {
              throw new Refusal(403, 'forbidden');
            }
            return result;
          });
          return reply.code(201).send(created);
        }),
    );

    // Saves a draft, and publishes it if asked.
    scope.patch<{
      Params: { tenant: string; id: string };
      Body: { body: Record<string, string>; publish?: boolean };
    }>(
      '/t/:tenant/documents/:id',
      {
        schema: {
          params: ID_PARAMS,
          body: {
            type: 'object',
            properties: {
              body: localizedSchema(DOCUMENT_MAX_LENGTH),
              publish: { type: 'boolean' },
            },
            required: ['body'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            refuseUnless(
              await updateDocument(
                trx,
                access.tenantId,
                request.params.id,
                publishable(
                  requiredLocalized(request.body.body, access),
                  access,
                  request.body.publish === true,
                ),
                request.body.publish === true,
              ),
            );
          });
          return reply.code(204).send();
        }),
    );

    // Deletes a draft.
    scope.delete<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/documents/:id',
      { schema: { params: ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            refuseUnless(await deleteDocument(trx, tenantId, request.params.id));
          });
          return reply.code(204).send();
        }),
    );
  };
