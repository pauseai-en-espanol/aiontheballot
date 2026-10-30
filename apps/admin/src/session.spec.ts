import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const { sessionFrom } = await import('./session');

describe('sessionFrom', () => {
  it("takes the API's stage, signed in or not", () => {
    const user = { id: 'u', name: 'Persona', email: 'p@example.org' };
    expect(sessionFrom(200, { stage: 'signed-in', user })).toEqual({
      stage: 'signed-in',
      user,
      recentSecondFactor: false,
    });
    // Whether the riskiest actions would run now (PLAN D23): only when the API says so in as many words.
    expect(sessionFrom(200, { stage: 'signed-in', user, recentSecondFactor: true })).toMatchObject({
      recentSecondFactor: true,
    });
    expect(sessionFrom(200, { stage: 'signed-in', user, recentSecondFactor: 'yes' })).toMatchObject(
      { recentSecondFactor: false },
    );
    expect(sessionFrom(200, { stage: 'enrol', user })).toEqual({ stage: 'enrol', user });
    expect(sessionFrom(401, { stage: 'challenge' })).toEqual({ stage: 'challenge' });
    expect(sessionFrom(401, { stage: 'signed-out' })).toEqual({ stage: 'signed-out' });
  });

  it('is unavailable while the API has no sign-in configured, or no /api for this host', () => {
    expect(sessionFrom(503, { error: 'Sign-in is not configured' })).toEqual({
      stage: 'unavailable',
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(sessionFrom(404, { error: 'Not found' })).toEqual({ stage: 'unavailable' });
  });

  it('treats anything else as a fault, never as signed in', () => {
    expect(() => sessionFrom(403, { error: 'Forbidden' })).toThrow(/403/);
    expect(() => sessionFrom(200, { stage: 'admin' })).toThrow(/200/);
    expect(() => sessionFrom(401, { stage: 'unavailable' })).toThrow(/401/);
    expect(() => sessionFrom(500, undefined)).toThrow(/500/);
  });
});
