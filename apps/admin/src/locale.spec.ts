import { describe, expect, it } from 'vitest';

import { backTo } from './locale';

describe('backTo', () => {
  it('goes back to a path on this host', () => {
    expect(backTo('/t/ejemplo-a/members')).toBe('/t/ejemplo-a/members');
    expect(backTo('/')).toBe('/');
    expect(backTo('/t/ejemplo-a/e/ejemplo-2027/parties/%C3%B1')).toBe(
      '/t/ejemplo-a/e/ejemplo-2027/parties/%C3%B1',
    );
  });

  it('never to another site, nor to anything but a path', () => {
    for (const value of [
      '//otro.example/x',
      '/\\otro.example',
      'https://otro.example/',
      'javascript:alert(1)',
      // Browsers drop tabs and newlines from a Location and read `\` as `/`, so these would be `//otro.example`.
      '/\t/otro.example',
      '/\t\\otro.example',
      '/\n/otro.example',
      // Nothing a header can't carry, nor another header.
      '/\r\nSet-Cookie:a=b',
      '/\0',
      '/€',
      `/${'a'.repeat(2048)}`,
      // Nor a broken escape, which the page would refuse.
      '/%ZZ',
      '/%',
      '/a%2',
      '',
      3,
      undefined,
    ]) {
      expect(backTo(value)).toBe('/');
    }
  });
});
