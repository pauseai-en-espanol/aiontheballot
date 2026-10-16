import { describe, expect, it } from 'vitest';

import { isPublicAddress } from './address.js';

describe('the addresses the fetcher may reach (ADR-0007 §2)', () => {
  it.each([
    '93.184.215.14',
    '1.1.1.1',
    '8.8.8.8',
    '2606:4700:4700::1111',
    '2a00:1450:4003:80e::200e',
    '::ffff:93.184.215.14',
  ])('allows the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.96.0.10',
    '100.64.0.1',
    '127.0.0.1',
    '127.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '203.0.113.9',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    'fe80::1',
    'fc00::1',
    'fd12:3456:789a::1',
    'ff02::1',
    '64:ff9b::a00:1',
    '2001::1',
    '2001:db8::1',
    '2002:a00:1::1',
    'localhost',
    'example.org',
    '',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
