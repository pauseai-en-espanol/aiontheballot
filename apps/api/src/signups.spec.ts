import { describe, expect, it } from 'vitest';

import type { Mailer, MailMessage } from './mail/mailer.js';

import { failedSignup, makeToken, normaliseAddress, sendOrUndo } from './signups.js';

const pgError = (code: string, routine = 'exec_stmt_raise') =>
  Object.assign(new Error(code), { code, routine });

describe('failedSignup', () => {
  it.each([
    ['a site that takes no signups (22023)', pgError('22023'), 'unavailable'],
    [
      "an address the database's check refuses (23514)",
      pgError('23514', 'ExecConstraints'),
      'invalid',
    ],
    ["the site's daily cap (54000)", pgError('54000'), 'limit'],
  ])('tells the public about %s', (_name, error, outcome) => {
    expect(failedSignup(error)).toBe(outcome);
  });

  it.each([
    ['a missing grant', pgError('42501', 'aclcheck_error')],
    ["Postgres's own limit", pgError('54000', 'index_form_tuple')],
    ['anything else', new Error('boom')],
  ])('throws %s as a fault', (_name, error) => {
    expect(failedSignup(error)).toBeUndefined();
  });
});

describe('makeToken', () => {
  it('makes 256 random bits, as 43 base64url characters', () => {
    const tokens = new Set(Array.from({ length: 100 }, makeToken));
    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[\w-]{43}$/u);
    }
  });
});

describe('normaliseAddress', () => {
  it.each([
    ['  Persona@Example.ORG ', 'persona@example.org'],
    ['persona@ejémplo.org', 'persona@xn--ejmplo-cva.org'],
    // The same letter, composed or decomposed: one spelling.
    ['jose\u0301@example.org', 'jos\u00e9@example.org'],
    ['persona+etiqueta@example.org', 'persona+etiqueta@example.org'],
  ])('writes %j as %j', (input, output) => {
    expect(normaliseAddress(input)).toBe(output);
  });

  it.each([
    'persona@ejemplo',
    'a@example.org, b@example.org',
    'persona@example.org\u0000',
    'per\u0007sona@example.org',
    'persona@exam/ple.org',
    'persona@example.com:25',
    'persona@ex%61mple.com',
    'persona@2130706433',
    'persona@0.0.0.0',
    'per\u200bsona@example.org',
    '+etiqueta@example.org',
    '@example.org',
    'nadie',
    `${'a'.repeat(250)}@example.org`,
  ])('refuses %j', (input) => {
    expect(normaliseAddress(input)).toBeUndefined();
  });
});

describe('sendOrUndo', () => {
  const message: MailMessage = { to: 'a@example.org', subject: 'S', text: 'T', fromName: 'F' };

  it('sends, and asks the database nothing', async () => {
    const sent: string[] = [];
    const mailer: Mailer = { send: async ({ to }) => void sent.push(to) };
    const errors: unknown[] = [];
    // A database that must not be asked anything.
    await sendOrUndo(undefined as never, mailer, { tenantId: 't', token: 'x', message }, (error) =>
      errors.push(error),
    );
    expect(sent).toEqual(['a@example.org']);
    expect(errors).toEqual([]);
  });
});
