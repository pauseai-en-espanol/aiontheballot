import { describe, expect, it } from 'vitest';

import { bearerMatches, headerMatches, readWorkerToken } from './token.js';

const TOKEN = 'un-secreto-compartido-de-prueba-de-mas-de-32';

describe('the secret the API and the worker share (ADR-0006)', () => {
  it('is at least 32 characters, and an error never echoes it', () => {
    expect(readWorkerToken(TOKEN)).toBe(TOKEN);
    expect(() => readWorkerToken(undefined)).toThrow(/at least 32/);
    expect(() => readWorkerToken('')).toThrow(/at least 32/);
    expect(() => readWorkerToken('x'.repeat(31))).toThrow(/at least 32/);
    expect(() => readWorkerToken('x'.repeat(31))).not.toThrow(/xxx/);
    expect(readWorkerToken('x'.repeat(32))).toBe('x'.repeat(32));
  });

  it('is what a header carries as it is: printable ASCII with no spaces', () => {
    for (const value of [`${TOKEN}\n`, `${TOKEN} x`, `${TOKEN}ñ`, `\t${TOKEN}`]) {
      expect(() => readWorkerToken(value)).toThrow(/printable ASCII/);
    }
    expect(() => readWorkerToken(`${TOKEN}ñ`)).not.toThrow(/secreto/);
  });

  it('matches only itself, as a bearer credential', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    for (const header of [
      undefined,
      '',
      TOKEN,
      `bearer ${TOKEN}`,
      `Basic ${TOKEN}`,
      `Bearer ${TOKEN} `,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.toUpperCase()}`,
      'Bearer ',
      ['Bearer', TOKEN],
    ]) {
      expect(bearerMatches(header, TOKEN)).toBe(false);
    }
  });

  it("matches only itself, as a header of its own (the preview's, PLAN R181)", () => {
    expect(headerMatches(TOKEN, TOKEN)).toBe(true);
    for (const header of [
      undefined,
      '',
      ` ${TOKEN}`,
      `${TOKEN} `,
      `Bearer ${TOKEN}`,
      TOKEN.slice(0, -1),
      `${TOKEN}x`,
      TOKEN.toUpperCase(),
      [TOKEN],
      [TOKEN, TOKEN],
    ]) {
      expect(headerMatches(header, TOKEN)).toBe(false);
    }
  });
});
