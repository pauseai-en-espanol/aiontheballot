import type { Database } from '@aiontheballot/db/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { InvitationSender } from '../admin/invitations.js';
import type { ProfileSource } from '../admin/profiles.js';
import type { InvitedAccounts } from './invited-accounts.js';

import { adminDataRoutes } from '../admin/routes.js';
import { type Auth, AUTH_BASE_PATH, TWO_FACTOR_COOKIE, VISITOR_ADDRESS_HEADER } from './auth.js';
import { invitationRoutes } from './invitation-routes.js';
import { actorOf, type FoundSession, stageOf } from './session.js';
import { visitorAddress } from './visitor.js';

/**
 * The Better Auth endpoints the admin uses, each with the only body fields passed on; every other endpoint answers 404
 * (sign-up, password changes, asking for a reset link, account linking, and whatever a Better Auth upgrade adds).
 * Fields left out on purpose: `rememberMe` (false makes a 24-hour session, A4.4), `trustDevice` (skips TOTP for 30
 * days, A4.4), `callbackURL`, and the enrolment's `method` and `issuer` (TOTP only, its issuer from configuration).
 */
const ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  '/sign-in/email': ['email', 'password'],
  '/sign-out': [],
  '/two-factor/enable': ['password'],
  '/two-factor/verify-totp': ['code'],
  '/two-factor/verify-backup-code': ['code'],
  // Sets a password with a single-use link's token (the owner's create-account command; A1). Nothing reachable
  // here asks for such a link: sending them waits for email.
  '/reset-password': ['token', 'newPassword'],
};

/** The headers Better Auth reads: the session, its CSRF checks (Origin, Fetch Metadata), the session's record. */
const PASSED_HEADERS = [
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest',
];

/** Response headers passed back: the body's type, cookies (below) and the rate limiter's wait. */
const RETURNED_HEADERS = ['content-type', 'x-retry-after'];

const pick = (body: unknown, fields: readonly string[]): Record<string, unknown> => {
  const source =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]),
  );
};

/**
 * Better Auth returns the session's token in the body too; the browser never needs it, and it is the cookie's whole
 * point that page scripts can't read it.
 */
const withoutToken = (body: string, contentType: string | null): string => {
  if (!contentType?.startsWith('application/json')) {
    return body;
  }
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'token' in value) {
      const { token: _token, ...rest } = value;
      return JSON.stringify(rest);
    }
  } catch {
    // Not JSON after all: passed on as it is.
  }
  return body;
};

const cookieHeaders = (request: FastifyRequest): Headers => {
  const headers = new Headers();
  if (request.headers.cookie) {
    headers.set('cookie', request.headers.cookie);
  }
  return headers;
};

const hasCookie = (request: FastifyRequest, name: string): boolean =>
  (request.headers.cookie ?? '').split(';').some((pair) => pair.trim().startsWith(`${name}=`));

export interface AdminRoutesOptions {
  /** Sign-in; without it every route here answers 503. */
  auth?: { auth: Auth; adminOrigin: string };
  /** Invitations (A2, A3): the invited accounts, as Better Auth's role, and the email. Without them, none is sent. */
  invitations?: { accounts: InvitedAccounts; send: InvitationSender };
  /** The aiontheballot_admin role's pool; without it the signed-in data routes answer 503. */
  admin?: Database;
  /** Members' names and emails, read as Better Auth's role; without it the members route answers 503. */
  profiles?: ProfileSource;
}

/**
 * Everything under `/api` (ADR-0003 §1): Better Auth's endpoints and the signed-in routes. They answer only on the
 * central admin host (ADR-0003 §4), as the gateway routes them: any other Host gets 404, so a gateway route added by
 * mistake on a public host still reaches nothing. The admin's server-side calls name the admin host too.
 */
export const adminRoutes =
  ({ auth: signIn, admin, profiles, invitations }: AdminRoutesOptions) =>
  async (scope: FastifyInstance): Promise<void> => {
    if (!signIn) {
      scope.all('/*', async (_request, reply) =>
        reply.code(503).send({ error: 'Sign-in is not configured' }),
      );
      return;
    }
    const { auth, adminOrigin } = signIn;
    const adminHost = new URL(adminOrigin).host;

    // JSON bodies only: Fastify also parses text/plain, which a cross-site form can send without a preflight. Only in
    // this scope; the public routes take no bodies anyway.
    scope.removeContentTypeParser('text/plain');

    scope.addHook('onRequest', async (request, reply) => {
      void reply.header('cache-control', 'no-store');
      if (request.headers.host !== adminHost) {
        return reply.code(404).send({ error: 'Not found' });
      }
    });

    scope.post<{ Params: { '*': string } }>('/auth/*', async (request, reply) => {
      const path = `/${request.params['*']}`;
      const fields = ENDPOINTS[path];
      if (!fields) {
        return reply.code(404).send({ error: 'Not found' });
      }
      const headers = new Headers({ 'content-type': 'application/json' });
      for (const name of PASSED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') {
          headers.set(name, value);
        }
      }
      const address = visitorAddress(
        request.headers['x-forwarded-for'],
        request.socket.remoteAddress,
      );
      if (address !== undefined) {
        headers.set(VISITOR_ADDRESS_HEADER, address);
      }
      const response = await auth.handler(
        new Request(`${adminOrigin}${AUTH_BASE_PATH}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(pick(request.body, fields)),
        }),
      );
      void reply.code(response.status);
      for (const name of RETURNED_HEADERS) {
        const value = response.headers.get(name);
        if (value !== null) {
          void reply.header(name, value);
        }
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        void reply.header('set-cookie', cookies);
      }
      return reply.send(withoutToken(await response.text(), response.headers.get('content-type')));
    });

    const findSession = async (request: FastifyRequest): Promise<FoundSession | null> =>
      auth.api.getSession({ headers: cookieHeaders(request) });

    // Where the request stands, for the admin's pages to decide what to show (A4.2). Never the token, nor the
    // session's address or browser.
    scope.get('/session', async (request, reply) => {
      const found = await findSession(request);
      const stage = stageOf(found, hasCookie(request, TWO_FACTOR_COOKIE));
      if (!found || stage === 'signed-out' || stage === 'challenge') {
        return reply.code(401).send({ stage });
      }
      const { id, name, email } = found.user;
      return { stage, user: { id, name, email } };
    });

    // Accepting an invitation, for whoever holds its link (invitation-routes.ts).
    await scope.register(
      invitationRoutes({ admin, accounts: invitations?.accounts, adminOrigin, findSession }),
    );

    // Everything a signed-in user reads and writes (admin/routes.ts), always as an aal2 actor.
    await scope.register(
      adminDataRoutes({
        admin,
        profiles,
        invitations,
        adminOrigin,
        actorFor: async (request) => actorOf(await findSession(request)),
      }),
    );
  };
