import { describe, expect, it } from 'vitest';

import { actorOf, type FoundSession, stageOf } from './session.js';

const found = (aal: number, twoFactorEnabled: boolean | null | undefined): FoundSession => ({
  session: { aal },
  user: {
    id: '0199c7a0-0000-7000-8000-000000000001',
    name: 'Persona de ejemplo',
    email: 'persona@example.org',
    twoFactorEnabled,
  },
});

describe('stageOf and actorOf (ADR-0002 §9)', () => {
  it('signs in only a session a second factor created, for a user with TOTP, and only then acts at aal2', () => {
    expect(stageOf(found(2, true), false)).toBe('signed-in');
    expect(actorOf(found(2, true))).toEqual({ userId: found(2, true).user.id, aal: 2 });
  });

  it('sends a user without TOTP to enrolment, with no actor', () => {
    for (const enabled of [false, null, undefined]) {
      expect(stageOf(found(1, enabled), false)).toBe('enrol');
      expect(actorOf(found(1, enabled))).toBeUndefined();
      // Nor at aal2: a user whose TOTP was reset enrols again before anything else.
      expect(stageOf(found(2, enabled), false)).toBe('enrol');
      expect(actorOf(found(2, enabled))).toBeUndefined();
    }
  });

  it('treats a password-only session of an enrolled user as signed out', () => {
    expect(stageOf(found(1, true), false)).toBe('signed-out');
    expect(stageOf(found(1, true), true)).toBe('signed-out');
    expect(actorOf(found(1, true))).toBeUndefined();
  });

  it('awaits a code while a challenge is pending, and is signed out otherwise', () => {
    expect(stageOf(null, true)).toBe('challenge');
    expect(stageOf(null, false)).toBe('signed-out');
    expect(actorOf(null)).toBeUndefined();
  });
});
