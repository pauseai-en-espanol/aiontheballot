import type { Database } from '@aiontheballot/db/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { withActor } from '@aiontheballot/db/actor';

import { acceptInvitation, pendingInvitation } from '../admin/invitations.js';
import { createRateLimiter } from '../rate-limit.js';
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
      return allow(visitor ?? 'unknown') ? undefined : 429;
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
              password: { type: 'string', maxLength: 256 },
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
          return accepted ? { accepted: true } : reply.code(404).send(invalid);
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
        const accepted = await withActor(admin, { userId, aal: 1 }, (trx) =>
          acceptInvitation(trx, token),
        );
        if (!accepted) {
          // Revoked or used in between: no account is left behind for a link that no longer works.
          await accounts.remove(userId);
          return reply.code(404).send(invalid);
        }
        return reply.code(201).send({ created: true });
      },
    );
  };
