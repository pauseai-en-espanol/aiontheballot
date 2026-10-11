import { describe, expect, it } from 'vitest';

import { authError, cleanBackupCode, cleanCode, describedBy } from './client';

describe('authError', () => {
  const answer = (status: number, code?: string) => ({
    ok: false,
    status,
    body: code === undefined ? {} : { code },
  });

  it('says what the person can do about each of Better Auth’s refusals', () => {
    expect(authError(answer(401, 'INVALID_EMAIL_OR_PASSWORD'))).toBe('invalidCredentials');
    expect(authError(answer(400, 'INVALID_PASSWORD'))).toBe('invalidPassword');
    expect(authError(answer(401, 'INVALID_CODE'))).toBe('invalidCode');
    expect(authError(answer(401, 'INVALID_BACKUP_CODE'))).toBe('invalidCode');
    // Better Auth answers a locked account with 429, like the rate limiter: the code tells them apart.
    expect(authError(answer(429, 'ACCOUNT_TEMPORARILY_LOCKED'))).toBe('locked');
    expect(authError(answer(401, 'INVALID_TWO_FACTOR_COOKIE'))).toBe('expired');
    expect(authError(answer(400, 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE'))).toBe('tooManyCodes');
    expect(authError(answer(400, 'INVALID_TOKEN'))).toBe('invalidLink');
    expect(authError(answer(400, 'PASSWORD_TOO_SHORT'))).toBe('passwordTooShort');
    expect(authError(answer(400, 'PASSWORD_TOO_LONG'))).toBe('passwordTooLong');
  });

  it('answers a rate limit as such, and anything unknown as unexpected', () => {
    expect(authError(answer(429))).toBe('rateLimited');
    expect(authError(answer(500))).toBe('unexpected');
    expect(authError(answer(0))).toBe('unexpected');
    expect(authError(answer(400, 'SOMETHING_NEW'))).toBe('unexpected');
  });
});

describe('cleanCode', () => {
  it('drops the spaces and dashes people type or paste', () => {
    expect(cleanCode(' 123 456 ')).toBe('123456');
    expect(cleanCode('123-456')).toBe('123456');
  });
});

describe('cleanBackupCode', () => {
  it('keeps the case and the dash Better Auth matches on, putting a missing dash back', () => {
    expect(cleanBackupCode(' aB3dE-fG7hJ ')).toBe('aB3dE-fG7hJ');
    expect(cleanBackupCode('aB3dEfG7hJ')).toBe('aB3dE-fG7hJ');
    expect(cleanBackupCode('aB3dE fG7hJ')).toBe('aB3dE-fG7hJ');
    expect(cleanBackupCode('short')).toBe('short');
  });
});

describe('describedBy', () => {
  it('lists the ids that exist, or none', () => {
    expect(describedBy('hint', 'error')).toBe('hint error');
    expect(describedBy('hint', false)).toBe('hint');
    expect(describedBy(undefined, false)).toBeUndefined();
  });
});
