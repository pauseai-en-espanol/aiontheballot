import { describe, expect, it } from 'vitest';

import { databaseRefusal } from './database-errors.js';

/** What node-postgres throws: an Error with the SQLSTATE and, for constraint violations, the constraint. */
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('a message the client must never see'), { code, ...extra });

describe('a database refusal', () => {
  it.each([
    ['42501', 403, 'forbidden'],
    ['23001', 409, 'stale'],
    ['23514', 422, 'incomplete'],
    ['23505', 409, 'taken'],
    ['22023', 400, 'invalid'],
    ['22P02', 400, 'invalid'],
  ])('answers %s with %i and the key %s', (code, status, error) => {
    expect(databaseRefusal(pgError(code))).toMatchObject({ status, error, report: false });
  });

  it('names the constraint of a unique or check violation, so the admin can point at the field', () => {
    expect(
      databaseRefusal(pgError('23505', { constraint: 'elections_tenant_id_slug_key' })),
    ).toEqual({
      status: 409,
      error: 'taken',
      constraint: 'elections_tenant_id_slug_key',
      report: false,
    });
    expect(
      databaseRefusal(pgError('23514', { constraint: 'elections_slug_not_reserved' })),
    ).toMatchObject({ constraint: 'elections_slug_not_reserved' });
    expect(databaseRefusal(pgError('42501', { constraint: 'x' }))).not.toHaveProperty('constraint');
  });

  it("never passes on the database's message or detail, which can quote what was written", () => {
    const refusal = databaseRefusal(
      pgError('23505', {
        detail: 'Key (email)=(persona@example.org) already exists.',
        constraint: 'invitations_email_key',
      }),
    );
    expect(JSON.stringify(refusal)).not.toMatch(/persona@example\.org|a message the client/);
  });

  it.each([
    ['an unknown SQLSTATE', pgError('40P01')],
    ['an error without one', new Error('connection lost')],
    ['something that is not an error', 'oops'],
    ['nothing', null],
    ['a code that is not a SQLSTATE', pgError('ECONNREFUSED')],
  ])('is an unexpected fault to report for %s', (_name, error) => {
    expect(databaseRefusal(error)).toEqual({ status: 500, error: 'unexpected', report: true });
  });
});
