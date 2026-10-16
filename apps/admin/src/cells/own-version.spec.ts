import { describe, expect, it } from 'vitest';

import { adoptOwnChange, answeredVersion, sentVersion } from './own-version';

describe("the cell page's own changes (admin forms §2, PLAN R190)", () => {
  it('reads the version a change was sent at, from its body or its address', () => {
    expect(sentVersion('/api/t/a/e/b/cells/c/checked', { version: 4, sourceId: 'x' })).toBe(4);
    expect(sentVersion('/api/t/a/e/b/cells/c/quotes/q?version=7', undefined)).toBe(7);
    expect(sentVersion('/api/t/a/e/b/cells/c/submit', { partyId: 'p' })).toBeUndefined();
    expect(sentVersion('/api/t/a/e/b/cells/c?version=abc', undefined)).toBeUndefined();
  });

  it('reads the version the API says the change left the cell at', () => {
    expect(answeredVersion({ version: 5 })).toBe(5);
    expect(answeredVersion({ sha256: 'f', version: 6 })).toBe(6);
    expect(answeredVersion({ id: 'x' })).toBeUndefined();
    expect(answeredVersion(undefined)).toBeUndefined();
  });

  it("adopts a change made from the version the draft's fields were loaded at, and only then", () => {
    expect(adoptOwnChange(3, { from: 3, to: 4 })).toBe(4);
    // Someone else's change came first: the fields stay at theirs, and say so.
    expect(adoptOwnChange(3, { from: 4, to: 5 })).toBe(3);
  });
});
