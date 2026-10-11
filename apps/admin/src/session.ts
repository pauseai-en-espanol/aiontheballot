import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getFromApi } from './api';

/**
 * Where a request stands in signing in, as the API decides it (apps/api/src/auth/session.ts), or `unavailable` while
 * the API can't say (sessionFrom).
 */
export type Stage = 'signed-in' | 'enrol' | 'challenge' | 'signed-out' | 'unavailable';

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  stage: Stage;
  user?: SignedInUser;
}

const STAGES: readonly string[] = ['signed-in', 'enrol', 'challenge', 'signed-out'];

const isSession = (value: unknown): value is Session =>
  typeof value === 'object' &&
  value !== null &&
  STAGES.includes((value as { stage?: unknown }).stage as string);

/** The page each stage belongs on. */
export const PAGE_OF: Readonly<Record<Stage, string>> = {
  'signed-in': '/',
  enrol: '/two-factor/enrol',
  challenge: '/two-factor',
  'signed-out': '/sign-in',
  unavailable: '/sign-in',
};

/** The request's own host and cookie, which the API needs to find the session. */
export const forwardedRequest = async () => {
  const incoming = await headers();
  const host = incoming.get('host');
  if (!host) {
    throw new Error('The request has no Host header');
  }
  return { host, cookie: incoming.get('cookie') ?? undefined };
};

/** The session the API's answer describes; any answer but these is a fault. */
export const sessionFrom = (status: number, body: unknown): Session => {
  if ((status === 200 || status === 401) && isSession(body)) {
    return body;
  }
  // 503: the API has no sign-in configured yet. 404: it doesn't know /api, as during a rollout that brings it, or it
  // doesn't take this host, which the log says. Either way nobody is signed in.
  if (status === 503 || status === 404) {
    if (status === 404) {
      console.error(
        'The API answered 404 for the session: is ADMIN_ORIGIN the host this admin is served on?',
      );
    }
    return { stage: 'unavailable' };
  }
  throw new Error(`The API answered ${status} for the session`);
};

export const getSession = async (): Promise<Session> => {
  const { status, body } = await getFromApi('/api/session', await forwardedRequest());
  return sessionFrom(status, body);
};

/**
 * Lets a page render only at the stages it serves, and sends any other request to its stage's page (editorial
 * workflow A4.2: a session without TOTP reaches only enrolment and the challenge). The API and the database check
 * again on every call; this only keeps people on the right page.
 */
export const requireStage = async (...stages: Stage[]): Promise<Session> => {
  const session = await getSession();
  if (!stages.includes(session.stage)) {
    redirect(PAGE_OF[session.stage]);
  }
  return session;
};
