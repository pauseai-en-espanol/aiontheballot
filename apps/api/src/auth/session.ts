import type { Actor } from '@aiontheballot/db/actor';

/**
 * Where a request stands in signing in (editorial workflow A4):
 *
 * - `signed-in`: a session a TOTP or backup code created, of a user with TOTP. The only stage with an actor, at aal2.
 * - `enrol`: a session of a user without TOTP yet. It reaches the enrolment and nothing else.
 * - `challenge`: no session, but a password was accepted and a code is awaited.
 * - `signed-out`: anything else, including a session a password alone opened before its user enrolled elsewhere, which
 *   can never become aal2.
 */
export type Stage = 'signed-in' | 'enrol' | 'challenge' | 'signed-out';

/** The parts of Better Auth's session that decide the stage. */
export interface FoundSession {
  session: { id: string; aal: number };
  user: { id: string; name: string; email: string; twoFactorEnabled?: boolean | null };
}

export const stageOf = (found: FoundSession | null, challengePending: boolean): Stage => {
  if (!found) {
    return challengePending ? 'challenge' : 'signed-out';
  }
  if (found.user.twoFactorEnabled !== true) {
    return 'enrol';
  }
  return found.session.aal === 2 ? 'signed-in' : 'signed-out';
};

/**
 * Who a request acts for in the database (ADR-0002 §3), only once signed in, and then always at aal2: a session
 * short of that gets no actor, so no route runs a query for it, and the database would give it nothing anyway.
 */
export const actorOf = (found: FoundSession | null): Actor | undefined =>
  found && stageOf(found, false) === 'signed-in' ? { userId: found.user.id, aal: 2 } : undefined;

/**
 * The token an `Authorization: Bearer` header carries (ADR-0008): undefined without the header, and empty for one
 * that carries no bearer token, which then stands for no one.
 */
export const bearerOf = (header: string | undefined): string | undefined => {
  if (header === undefined) {
    return undefined;
  }
  // The scheme's case doesn't matter (RFC 9110 §11.1).
  const match = /^bearer (\S+)$/i.exec(header);
  return match?.[1] ?? '';
};
