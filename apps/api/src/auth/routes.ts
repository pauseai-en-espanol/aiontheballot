import type { Database } from '@aiontheballot/db/client';
import type { FileStore } from '@aiontheballot/db/file-store';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getAuthenticatorName } from '@better-auth/passkey';

import type { InvitationSender } from '../admin/invitations.js';
import type { ProfileSource } from '../admin/profiles.js';
import type { ArchiveDispatch, ExtractionDispatch } from '../admin/sources.js';
import type { FetcherClient } from '../fetcher-client.js';
import type { InvitedAccounts } from './invited-accounts.js';
import type { PasswordLinks } from './password-links.js';

import { adminDataRoutes } from '../admin/routes.js';
import { createRateLimiter } from '../rate-limit.js';
import { type Auth, AUTH_BASE_PATH, TWO_FACTOR_COOKIE, VISITOR_ADDRESS_HEADER } from './auth.js';
import { invitationRoutes } from './invitation-routes.js';
import { MAX_ACTIVE, MAX_DAYS, type MemberTokens, TokenRefusal } from './member-tokens.js';
import { actorOf, bearerOf, type FoundSession, stageOf } from './session.js';
import { visitorAddress } from './visitor.js';

/**
 * The Better Auth endpoints the admin uses, each with the only body fields passed on; every other endpoint answers 404
 * (sign-up, password changes while signed in, account linking, and whatever a Better Auth upgrade adds). Fields left
 * out on purpose: `rememberMe` (false makes a 24-hour session, A4.4), `trustDevice` (skips TOTP for 30 days, A4.4),
 * `callbackURL` and `redirectTo` (the link is the API's own, auth.ts), the enrolment's `method` and `issuer` (TOTP
 * only, its issuer from configuration), and a passkey's `createSession` (adding one never signs anyone in).
 */
const ENDPOINTS: Readonly<Record<string, readonly string[]>> = {
  '/sign-in/email': ['email', 'password'],
  '/sign-out': [],
  '/two-factor/enable': ['password'],
  '/two-factor/verify-totp': ['code'],
  '/two-factor/verify-backup-code': ['code'],
  // Sets a password with a single-use link's token: from the owner's create-account command (A1), "I forgot my
  // password" or a site's members (A5, PLAN R170).
  '/reset-password': ['token', 'newPassword'],
  // "I forgot my password" (A5.2): the same answer whether or not the address has an account; Better Auth limits it
  // per visitor, and auth.ts sends an account at most one link every 15 minutes.
  '/request-password-reset': ['email'],
  // Passkeys (PLAN D22): signing in with one, and, signed in, adding or removing one's own.
  '/passkey/verify-authentication': ['response'],
  '/passkey/verify-registration': ['response', 'name'],
  '/passkey/delete-passkey': ['id'],
};

/** Better Auth's endpoints read with GET, with no query passed on: a passkey's challenge, to sign in or to add one. */
const GET_ENDPOINTS: ReadonlySet<string> = new Set([
  '/passkey/generate-authenticate-options',
  '/passkey/generate-register-options',
]);

/**
 * Endpoints only a signed-in session reaches (a second factor passed, `stageOf`), whatever Better Auth itself accepts:
 * it would let a session a password alone opened, before enrolling, add a passkey.
 */
const SIGNED_IN_ONLY: ReadonlySet<string> = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
]);

/**
 * The headers Better Auth reads: the session, its CSRF checks (Origin, Fetch Metadata), the session's record; and the
 * page's language, for the account mail a request sends (the switch's cookie, else Accept-Language).
 */
const PASSED_HEADERS = [
  'accept-language',
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
 * Better Auth returns the session's token in the body too, on its own or in the session a passkey's sign-in returns;
 * the browser never needs it, and it is the cookie's whole point that page scripts can't read it.
 */
const withoutToken = (body: string, contentType: string | null): string => {
  if (!contentType?.startsWith('application/json')) {
    return body;
  }
  try {
    const value: unknown = JSON.parse(body);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const { token, session, ...rest } = value as Record<string, unknown>;
      return token === undefined && session === undefined ? body : JSON.stringify(rest);
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
  /** Password reset emails from the members page (PLAN R170), as Better Auth's role. Without them, none is sent. */
  passwordLinks?: PasswordLinks;
  /** The file store, for sources' copies (S2, S6). */
  files?: FileStore;
  /** The worker's dispatch, for extraction (R116). */
  extraction?: ExtractionDispatch;
  /** The fetcher, for copies by URL (ADR-0007). */
  fetcher?: FetcherClient;
  /** Snapshots, through the fetcher and the worker (ADR-0007). */
  archives?: ArchiveDispatch;
  /** Tells the public site's replicas a site changed (R151). */
  revalidate?: (target: { tenant: string; election?: string }) => void;
  /** The aiontheballot_admin role's pool; without it the signed-in data routes answer 503. */
  admin?: Database;
  /** Members' names and emails, read as Better Auth's role; without it the members route answers 503. */
  profiles?: ProfileSource;
  /** Members' tokens for tools (ADR-0008), as Better Auth's role; without them no token is minted or accepted. */
  tokens?: MemberTokens;
}

/**
 * Everything under `/api` (ADR-0003 §1): Better Auth's endpoints and the signed-in routes. They answer only on the
 * central admin host (ADR-0003 §4), as the gateway routes them: any other Host gets 404, so a gateway route added by
 * mistake on a public host still reaches nothing. The admin's server-side calls name the admin host too.
 */
export const adminRoutes =
  ({
    auth: signIn,
    admin,
    profiles,
    invitations,
    passwordLinks,
    files,
    extraction,
    fetcher,
    archives,
    revalidate,
    tokens,
  }: AdminRoutesOptions) =>
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

    // Every answer is data, never a page (PLAN R145): not to be sniffed into something else, framed, or read by another
    // site. The routes that serve files set their own, sandboxed policy over this one.
    scope.addHook('onRequest', async (request, reply) => {
      void reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'same-origin')
        .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
      if (request.headers.host !== adminHost) {
        return reply.code(404).send({ error: 'Not found' });
      }
    });
    // Fastify's own 404 skips this scope's hook, and names the method and path: this one runs it (PLAN R208).
    scope.setNotFoundHandler(async (_request, reply) =>
      reply.code(404).send({ error: 'Not found' }),
    );

    const findSession = async (request: FastifyRequest): Promise<FoundSession | null> =>
      auth.api.getSession({ headers: cookieHeaders(request) });

    /** The member's session, signed in with their second factor; never one beside a token (ADR-0008). */
    const signedInSession = async (request: FastifyRequest): Promise<FoundSession | undefined> => {
      if (request.headers.authorization !== undefined) {
        return undefined;
      }
      const found = await findSession(request);
      return found && stageOf(found, false) === 'signed-in' ? found : undefined;
    };

    /** Passes one request on to Better Auth, with only what it reads, and its answer back without the token. */
    const forward = async (
      request: FastifyRequest,
      reply: FastifyReply,
      path: string,
      body?: Record<string, unknown>,
    ) => {
      const headers = new Headers(body === undefined ? {} : { 'content-type': 'application/json' });
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
          method: body === undefined ? 'GET' : 'POST',
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    };

    scope.post<{ Params: { '*': string } }>('/auth/*', async (request, reply) => {
      const path = `/${request.params['*']}`;
      const fields = ENDPOINTS[path];
      if (!fields) {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (SIGNED_IN_ONLY.has(path) && !(await signedInSession(request))) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      return forward(request, reply, path, pick(request.body, fields));
    });

    scope.get<{ Params: { '*': string } }>('/auth/*', async (request, reply) => {
      const path = `/${request.params['*']}`;
      if (!GET_ENDPOINTS.has(path)) {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (SIGNED_IN_ONLY.has(path) && !(await signedInSession(request))) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      return forward(request, reply, path);
    });

    // One's own passkeys (PLAN D22), for the passkeys page: what tells them apart, never their keys or the device's
    // identifiers.
    scope.get('/passkeys', async (request, reply) => {
      if (!(await signedInSession(request))) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      const response = await auth.handler(
        new Request(`${adminOrigin}${AUTH_BASE_PATH}/passkey/list-user-passkeys`, {
          headers: cookieHeaders(request),
        }),
      );
      if (!response.ok) {
        return reply.code(502).send({ error: 'unexpected' });
      }
      const listed = (await response.json()) as {
        id: string;
        name?: string | null;
        aaguid?: string | null;
        backedUp: boolean;
        createdAt?: string | null;
      }[];
      return {
        passkeys: listed.map((passkey) => ({
          id: passkey.id,
          name: passkey.name ?? null,
          provider: getAuthenticatorName(passkey.aaguid ?? undefined) ?? null,
          synced: passkey.backedUp,
          createdAt: passkey.createdAt ?? null,
        })),
      };
    });

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

    // A member's tokens for tools (ADR-0008, PLAN R203): minted, listed and revoked by the member, signed in with their
    // second factor, in the admin; never through a token. Shown once, when minted.
    // A few an hour per member: enough to replace a lost one, not to mint a pile.
    const allowMint = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
    scope.get('/tokens', async (request, reply) => {
      // Without tokens there is nothing to list: the admin's page says so as a page that isn't there.
      if (!tokens) {
        return reply.code(404).send({ error: 'notFound' });
      }
      const found = await signedInSession(request);
      if (!found) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      return { tokens: await tokens.list(found.user.id), maxDays: MAX_DAYS, maxActive: MAX_ACTIVE };
    });
    scope.post<{ Body: { name: string; days: number } }>(
      '/tokens',
      {
        schema: {
          body: {
            type: 'object',
            required: ['name', 'days'],
            additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 200 },
              days: { type: 'integer', minimum: 1, maximum: MAX_DAYS },
            },
          },
        },
      },
      async (request, reply) => {
        if (!tokens) {
          return reply.code(503).send({ error: 'Tokens are not configured' });
        }
        const found = await signedInSession(request);
        if (!found) {
          return reply.code(401).send({ error: 'Sign in with your second factor first' });
        }
        if (request.headers.origin !== adminOrigin) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (!allowMint(found.user.id)) {
          return reply.code(429).send({ error: 'limit' });
        }
        try {
          const minted = await tokens.mint({
            userId: found.user.id,
            sessionId: found.session.id,
            name: request.body.name,
            days: request.body.days,
          });
          return reply.code(201).send({ token: minted.token, ...minted.summary });
        } catch (error) {
          // In the admin's words for any form (write.ts): a field it can't take, or a limit reached.
          if (error instanceof TokenRefusal) {
            return error.reason === 'tooMany'
              ? reply.code(409).send({ error: 'tooManyTokens' })
              : reply.code(400).send({ error: 'invalid', field: error.reason });
          }
          // The session ended, or its second factor went, since it was read: the database refuses the token.
          if ((error as { code?: unknown }).code === '42501') {
            return reply.code(401).send({ error: 'Sign in with your second factor first' });
          }
          throw error;
        }
      },
    );
    scope.delete<{ Params: { id: string } }>('/tokens/:id', async (request, reply) => {
      if (!tokens) {
        return reply.code(503).send({ error: 'Tokens are not configured' });
      }
      const found = await signedInSession(request);
      if (!found) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      if (request.headers.origin !== adminOrigin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      return (await tokens.revoke(found.user.id, request.params.id))
        ? reply.code(204).send()
        : reply.code(404).send({ error: 'notFound' });
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
        passwordLinks,
        files,
        extraction,
        fetcher,
        archives,
        revalidate,
        adminOrigin,
        // A token a tool sends (ADR-0008) or the member's session, never both: with a cookie too it stands for no one,
        // so a token can't lend a browser's request its own reach, nor a session its exemption from the Origin check.
        actorFor: async (request) => {
          const bearer = bearerOf(request.headers.authorization);
          if (bearer === undefined) {
            return actorOf(await findSession(request));
          }
          if (!tokens || bearer === '' || request.headers.cookie !== undefined) {
            return undefined;
          }
          const found = await tokens.find(bearer);
          return found ? { userId: found.userId, aal: 2, tokenId: found.tokenId } : undefined;
        },
      }),
    );
  };
