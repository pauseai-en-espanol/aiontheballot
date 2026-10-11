import { describe, expect, it } from 'vitest';

import { visitorAddress } from './visitor.js';

describe('visitorAddress', () => {
  it("takes the last X-Forwarded-For entry, the gateway's, never an earlier one a client wrote", () => {
    expect(visitorAddress('203.0.113.7', '10.0.0.5')).toBe('203.0.113.7');
    expect(visitorAddress('198.51.100.1, 203.0.113.7', '10.0.0.5')).toBe('203.0.113.7');
    expect(visitorAddress(' 198.51.100.1 ,203.0.113.7 , ', '10.0.0.5')).toBe('203.0.113.7');
    expect(visitorAddress(['198.51.100.1', '2001:db8::7'], '10.0.0.5')).toBe('2001:db8::7');
  });

  it("falls back to the connection's address, so an attempt with no valid entry is still counted", () => {
    expect(visitorAddress(undefined, '10.0.0.5')).toBe('10.0.0.5');
    expect(visitorAddress('', '::ffff:10.0.0.5')).toBe('::ffff:10.0.0.5');
    expect(visitorAddress('203.0.113.7, not-an-address', '10.0.0.5')).toBe('10.0.0.5');
    expect(visitorAddress('not-an-address', undefined)).toBeUndefined();
  });
});
