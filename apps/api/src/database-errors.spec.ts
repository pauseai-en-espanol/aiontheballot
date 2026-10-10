import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { databaseRefusal, REFUSAL_KEYS } from './database-errors.js';

/** What node-postgres throws: an Error with the SQLSTATE and, for constraint violations, the constraint. */
const pgError = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('a message the client must never see'), { code, ...extra });

describe('a database refusal', () => {
  it.each([
    ['42501', 403, 'forbidden'],
    ['23001', 409, 'stale'],
    ['40001', 409, 'stale'],
    ['40P01', 409, 'stale'],
    ['23514', 422, 'incomplete'],
    ['23505', 409, 'taken'],
    ['23503', 409, 'linked'],
    ['54000', 429, 'limit'],
    ['22023', 400, 'invalid'],
    ['22P02', 400, 'invalid'],
    ['22007', 400, 'invalid'],
    ['22008', 400, 'invalid'],
  ])('answers %s with %i and the key %s', (code, status, error) => {
    expect(databaseRefusal(pgError(code))).toMatchObject({ status, error, report: false });
  });

  it('answers a refusal by RLS or a trigger as forbidden, but a missing grant as a fault to report', () => {
    expect(databaseRefusal(pgError('42501', { routine: 'ExecWithCheckOptions' }))).toMatchObject({
      status: 403,
      report: false,
    });
    expect(databaseRefusal(pgError('42501', { routine: 'exec_stmt_raise' }))).toMatchObject({
      status: 403,
      report: false,
    });
    for (const routine of ['aclcheck_error', 'aclcheck_error_col']) {
      expect(databaseRefusal(pgError('42501', { routine }))).toEqual({
        status: 500,
        error: 'unexpected',
        report: true,
      });
    }
  });

  it('names the constraint of a unique, foreign key or check violation, so the admin can point at the field', () => {
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
    expect(
      databaseRefusal(
        pgError('23503', { constraint: 'review_events_tenant_id_assessment_id_fkey' }),
      ),
    ).toMatchObject({ constraint: 'review_events_tenant_id_assessment_id_fkey' });
    expect(databaseRefusal(pgError('42501', { constraint: 'x' }))).not.toHaveProperty('constraint');
    expect(databaseRefusal(pgError('23001', { constraint: 'x' }))).not.toHaveProperty('constraint');
  });

  it.each(['en', 'es'])('has a message in %s for every key', async (locale) => {
    const messages = JSON.parse(
      await readFile(
        new URL(`../../../packages/i18n/src/messages/${locale}.json`, import.meta.url),
        'utf8',
      ),
    ) as { errors: Record<string, string> };
    for (const key of REFUSAL_KEYS) {
      expect(messages.errors[key], key).toMatch(/\S/);
    }
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
    ['an unknown SQLSTATE', pgError('57014')],
    ['an error without one', new Error('connection lost')],
    ['something that is not an error', 'oops'],
    ['nothing', null],
    ['a code that is not a SQLSTATE', pgError('ECONNREFUSED')],
  ])('is an unexpected fault to report for %s', (_name, error) => {
    expect(databaseRefusal(error)).toEqual({ status: 500, error: 'unexpected', report: true });
  });
});
