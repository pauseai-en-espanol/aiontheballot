import { describe, expect, it } from 'vitest';

import { answerOf, writeError } from './write';

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
    // An upload Fastify refuses before the API sees it: too large, or of a type no source has.
    expect(writeError(413, { code: 'FST_ERR_CTP_BODY_TOO_LARGE' })).toBe('tooLarge');
    expect(writeError(415, { code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' })).toBe('fileType');
    expect(writeError(409, { error: 'toString' })).toBe('unexpected');
  });
});

describe('answerOf', () => {
  const answer = (status: number, body: unknown) =>
    answerOf(new Response(JSON.stringify(body), { status }));

  it('passes on the constraint and the field a refusal names, so a form can point at it', async () => {
    expect(await answer(400, { error: 'invalid', field: 'reportRetentionDays' })).toEqual({
      ok: false,
      error: 'invalid',
      field: 'reportRetentionDays',
    });
    expect(await answer(409, { error: 'taken', constraint: 'tenants_slug_key' })).toEqual({
      ok: false,
      error: 'taken',
      constraint: 'tenants_slug_key',
    });
    expect(await answer(400, { error: 'invalid', field: 3 })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
