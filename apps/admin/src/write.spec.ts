import { describe, expect, it } from 'vitest';

import { writeError } from './write';

describe('writeError', () => {
  it("takes the API's key, the database's refusals and its own", () => {
    expect(writeError(409, { error: 'taken', constraint: 'memberships_pkey' })).toBe('taken');
    expect(writeError(409, { error: 'lastCountryAdmin' })).toBe('lastCountryAdmin');
    expect(writeError(403, { error: 'forbidden' })).toBe('forbidden');
  });

  it('calls a malformed request invalid, a lost session signed out, and anything else unexpected', () => {
    expect(writeError(400, { statusCode: 400, code: 'FST_ERR_VALIDATION' })).toBe('invalid');
    expect(writeError(401, { error: 'Sign in with your second factor first' })).toBe('signedOut');
    expect(writeError(500, { error: 'unexpected' })).toBe('unexpected');
    expect(writeError(502, undefined)).toBe('unexpected');
    expect(writeError(409, { error: 'toString' })).toBe('unexpected');
  });
});
