import { describe, expect, it } from 'vitest';

import { confirmPath, safeNext } from './confirm';

describe('confirming it’s you again (PLAN D23)', () => {
  it('comes back only to a page of the admin', () => {
    expect(safeNext('/t/sitio-de-ejemplo/members')).toBe('/t/sitio-de-ejemplo/members');
    expect(safeNext('/t/sitio-de-ejemplo/audit?before=x')).toBe(
      '/t/sitio-de-ejemplo/audit?before=x',
    );
    for (const elsewhere of [
      '//ejemplo.test',
      '/\\ejemplo.test',
      'https://ejemplo.test',
      'members',
      '',
      undefined,
      ['/t'],
    ]) {
      expect(safeNext(elsewhere)).toBe('/');
    }
  });

  it('carries where to come back to in its address', () => {
    expect(confirmPath('/tokens')).toBe('/confirm?next=%2Ftokens');
    expect(confirmPath('//ejemplo.test')).toBe('/confirm?next=%2F');
  });
});
