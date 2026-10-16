import { describe, expect, it } from 'vitest';

import { hashInvitationToken, makeInvitationToken, plainName } from './invitations.js';

describe('invitation tokens', () => {
  it('are 256 random bits, kept as their SHA-256', () => {
    const token = makeInvitationToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(makeInvitationToken()).not.toBe(token);
    expect(hashInvitationToken('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('plainName', () => {
  it('keeps an inviter’s name to one plain line, with no link of its own', () => {
    expect(plainName('  Persona   de\nejemplo  ')).toBe('Persona de ejemplo');
    expect(plainName('Persona https://phishing.example.test/entra ya')).toBe('Persona ya');
    expect(plainName('Persona www.example.test')).toBe('Persona');
    expect(plainName('a'.repeat(200))).toHaveLength(80);
    expect(plainName('Persona‮oculta')).toBe('Persona oculta');
  });
});
