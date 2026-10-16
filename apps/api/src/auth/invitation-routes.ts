import type { Database } from '@aiontheballot/db/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { withActor } from '@aiontheballot/db/actor';
import { captureException } from '@sentry/node';

import { acceptInvitation, pendingInvitation } from '../admin/invitations.js';
import { createRateLimiter, visitorKey } from '../rate-limit.js';
import { MAX_PASSWORD_LENGTH } from './auth.js';
import { InvitedAccountRefusal, type InvitedAccounts } from './invited-accounts.js';
import { actorOf, type FoundSession, stageOf } from './session.js';
import { visitorAddress } from './visitor.js';

export interface InvitationRoutesOptions {
  /** The aiontheballot_admin role's pool, for the database's two narrow functions. */
  admin: Database | undefined;
  accounts: InvitedAccounts | undefined;
  adminOrigin: string;
  findSession: (request: FastifyRequest) => Promise<FoundSession | null>;
  /** Attempts per visitor and 10 minutes, lookups and acceptances together. */
  attemptsPerVisitor?: number;
}

const TOKEN = { type: 'string', minLength: 1, maxLength: 200 } as const;

/**
 * Accepting an invitation (editorial workflow A3; PLAN R114), on the admin host, for whoever holds the link: its token
 * comes from the page, which read it from the link's fragment, and is never logged. Every token that names no pending
 * invitation gets the same answer, so nothing about the invitation leaks; attempts are limited per visitor.
 *
 * - `POST /invitations/lookup`: what is offered (the invited email and role), whether that email has an account, and
 *   whether the visitor is signed in as it.
 * - `POST /invitations/accept`: signed in (with TOTP) as the invited email, accepts it; with no account for that email,
 *   creates one with the name and password given, the email verified, accepts it at aal1 (nothing until TOTP, W3), and
 *   leaves signing in to the person.
 */
export const invitationRoutes =
  ({
    admin,
    accounts,
    adminOrigin,
    findSession,
    attemptsPerVisitor = 20,
  }: InvitationRoutesOptions) =>
  async (scope: FastifyInstance): Promise<void> => {
    const allow = createRateLimiter({ limit: attemptsPerVisitor, windowMs: 10 * 60_000 });
    const invalid = { error: 'invalid' } as const;

    // A fault here is logged by its database error class and where it came from, never its message or detail, which
    // can quote the invited address (a unique violation on auth.users' email, say).
    scope.setErrorHandler(async (error, request, reply) => {
      const { code, routine, statusCode } = error as {
        code?: unknown;
        routine?: unknown;
        statusCode?: unknown;
      };
      if (typeof statusCode === 'number' && statusCode < 500) {
        return reply.code(statusCode).send({ error: 'invalid' });
      }
      request.log.error({ code, routine }, 'Accepting an invitation failed');
      captureException(
        new Error(
          `Accepting an invitation failed: ${typeof code === 'string' ? code : 'not a database error'}`,
        ),
      );
      return reply.code(500).send({ error: 'unexpected' });
    });

    const guard = (request: FastifyRequest): 403 | 429 | 503 | undefined => {
      if (!admin || !accounts) {
        return 503;
      }
      // Like every write on the admin host: from one of its pages.
      if (request.headers.origin !== adminOrigin) {
        return 403;
      }
      const visitor = visitorAddress(
        request.headers['x-forwarded-for'],
        request.socket.remoteAddress,
      );
      // Counted by visitor, an IPv6 /64 as one, as signups and sign-in count (rate-limit.ts).
      return allow(visitorKey(visitor ?? 'unknown')) ? undefined : 429;
    };

    scope.post<{ Body: { token: string } }>(
      '/invitations/lookup',
      {
        schema: {
          body: {
            type: 'object',
            properties: { token: TOKEN },
            required: ['token'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const refused = guard(request);
        if (refused || !admin || !accounts) {
          return reply
            .code(refused ?? 503)
            .send({ error: refused === 429 ? 'limit' : 'unavailable' });
        }
        const offer = await pendingInvitation(admin, request.body.token);
        if (!offer) {
          return reply.code(404).send(invalid);
        }
        const found = await findSession(request);
        const signedIn = found && stageOf(found, false) === 'signed-in' ? found.user : undefined;
        return {
          email: offer.email,
          role: offer.role,
          // Where it invites to (PLAN R199): the holder of the link was emailed the site's name already.
          site: offer.site,
          account: (await accounts.accountId(offer.email)) !== undefined,
          session: !signedIn
            ? 'none'
            : signedIn.email.toLowerCase() === offer.email
              ? 'same'
              : 'other',
        };
      },
    );

    scope.post<{ Body: { token: string; name?: string; password?: string } }>(
      '/invitations/accept',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              token: TOKEN,
              name: { type: 'string', maxLength: 200 },
              password: { type: 'string', maxLength: MAX_PASSWORD_LENGTH },
            },
            required: ['token'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const refused = guard(request);
        if (refused || !admin || !accounts) {
          return reply
            .code(refused ?? 503)
            .send({ error: refused === 429 ? 'limit' : 'unavailable' });
        }
        const { token, name, password } = request.body;
        const actor = actorOf(await findSession(request));
        if (actor) {
          const accepted = await withActor(admin, actor, (trx) => acceptInvitation(trx, token));
          if (accepted) {
            return { accepted: true };
          }
          // Still pending, then it was refused for the email: the visitor holds the link, so they may hear that.
          return (await pendingInvitation(admin, token))
            ? reply.code(409).send({ error: 'otherAccount' })
            : reply.code(404).send(invalid);
        }
        const offer = await pendingInvitation(admin, token);
        if (!offer) {
          return reply.code(404).send(invalid);
        }
        if ((await accounts.accountId(offer.email)) !== undefined) {
          return reply.code(409).send({ error: 'signInFirst' });
        }
        let userId: string;
        try {
          userId = await accounts.create({
            email: offer.email,
            name: name ?? '',
            password: password ?? '',
          });
        } catch (error) {
          if (error instanceof InvitedAccountRefusal) {
            return reply
              .code(error.reason === 'exists' ? 409 : 400)
              .send({ error: error.reason === 'exists' ? 'signInFirst' : error.reason });
          }
          throw error;
        }
        let accepted = false;
        try {
          accepted = await withActor(admin, { userId, aal: 1 }, (trx) =>
            acceptInvitation(trx, token),
          );
        } finally {
          // Revoked or used in between, or a fault: no account is left behind for a link that didn't work.
          if (!accepted) {
            await accounts.remove(userId).catch(() => undefined);
          }
        }
        return accepted ? reply.code(201).send({ created: true }) : reply.code(404).send(invalid);
      },
    );
  };
