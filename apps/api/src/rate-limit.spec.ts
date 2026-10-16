import { describe, expect, it } from 'vitest';

import { createRateLimiter, visitorKey } from './rate-limit.js';

describe('createRateLimiter', () => {
  it('lets `limit` requests through per key and window, then refuses until the window ends', () => {
    let time = 0;
    const allow = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => time });
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    time = 999;
    expect(allow('a')).toBe(false);
    time = 1_000;
    expect(allow('a')).toBe(true);
  });

  it('keeps its memory bounded, dropping finished windows first', () => {
    let time = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 10, maxKeys: 2, now: () => time });
    allow('a');
    time = 5;
    allow('b');
    expect(allow('b')).toBe(false);
    time = 12;
    // a's window is over: dropped to make room, while b's still counts.
    allow('c');
    time = 14;
    expect(allow('b')).toBe(false);
  });
});

describe('the rate limiter, full', () => {
  it('drops the windows opened longest ago, never all of them at once', () => {
    const time = 0;
    const allow = createRateLimiter({ limit: 1, windowMs: 100, maxKeys: 2, now: () => time });
    allow('a');
    allow('b');
    // A third visitor makes room by dropping a, the oldest; b's window still counts.
    allow('c');
    expect(allow('b')).toBe(false);
    expect(allow('a')).toBe(true);
  });
});

describe('visitorKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:DB8:1:2::9', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:cb00:7107', '203.0.113.7'],
    ['::ffff:198.51.100.1', '198.51.100.1'],
    ['nada', 'unknown'],
    ['', 'unknown'],
  ])('counts %j as %j', (address, key) => {
    expect(visitorKey(address)).toBe(key);
  });
});
