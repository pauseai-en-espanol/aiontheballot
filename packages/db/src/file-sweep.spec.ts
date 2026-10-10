import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRACE_DAYS,
  EMPTY_LEDGER,
  fileKey,
  MIN_GRACE_DAYS,
  parseLedger,
  parseSweepInput,
  planSweep,
} from './file-sweep.js';

const TENANT = '0190f8c4-5eed-7000-8000-00000000000a';
const [A, B, C] = ['a', 'b', 'c'].map((c) => c.repeat(64)) as [string, string, string];
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2030-01-01T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const key = (sha: string) => fileKey({ tenantId: TENANT, bucket: 'sources' }, sha);
const named = (...keys: string[]) => ({ named: new Set(keys), deletedAt: new Map<string, Date>() });

describe("the owner's list", () => {
  it('reads named files, deleted ones and the snapshot', () => {
    const input = parseSweepInput(
      [
        `${TENANT} sources ${A}`,
        `${TENANT} public_assets ${B}`,
        `platform ${C}`,
        `deleted ${TENANT} sources ${B} 2029-06-01T10:00:00Z`,
        `deleted ${TENANT} sources ${B} 2029-07-01T10:00:00.5Z`,
        `deleted platform ${A} 2029-05-01T10:00:00Z`,
        'end 6 2030-01-01T00:00:00Z',
      ].join('\r\n'),
    );
    expect([...input.named].sort()).toEqual(
      [key(A), fileKey({ tenantId: TENANT, bucket: 'public_assets' }, B), `platform/${C}`].sort(),
    );
    // The last deletion of each key counts.
    expect(input.deletedAt).toEqual(
      new Map([
        [key(B), new Date('2029-07-01T10:00:00.5Z')],
        [`platform/${A}`, new Date('2029-05-01T10:00:00Z')],
      ]),
    );
    expect(input.snapshot).toEqual(new Date('2030-01-01T00:00:00Z'));
  });

  it('takes an empty database, said so', () => {
    expect(parseSweepInput('end 0 2030-01-01T00:00:00Z').named.size).toBe(0);
  });

  it.each([
    ['without its end line (cut short)', `${TENANT} sources ${A}\n`, 'cut short'],
    ['nothing at all', '', 'cut short'],
    ['without a snapshot', `${TENANT} sources ${A}\nend 1`, 'cut short'],
    [
      'with fewer lines than it says',
      `${TENANT} sources ${A}\nend 2 2030-01-01T00:00:00Z`,
      'says 2',
    ],
    [
      'with more lines than it says',
      `${TENANT} sources ${A}\nplatform ${B}\nend 1 2030-01-01T00:00:00Z`,
      'says 1',
    ],
    ['with lines after its end', `end 0 2030-01-01T00:00:00Z\n${TENANT} sources ${A}`, 'cut short'],
    [
      'with an unknown bucket',
      `${TENANT} logos ${A}\nend 1 2030-01-01T00:00:00Z`,
      'Not a named file',
    ],
    [
      'with a tenant that is not an id',
      `../x sources ${A}\nend 1 2030-01-01T00:00:00Z`,
      'Not a named file',
    ],
    [
      'with a malformed hash',
      `platform ${A.toUpperCase()}\nend 1 2030-01-01T00:00:00Z`,
      'Not a named file',
    ],
    [
      'with psql decorations that keep the count',
      ` ?column? \nplatform ${A}\nend 2 2030-01-01T00:00:00Z`,
      'Not a named file',
    ],
    [
      'with a deletion without its date',
      `deleted platform ${A}\nend 1 2030-01-01T00:00:00Z`,
      'Not an instant',
    ],
    [
      'with a date that is not UTC',
      `deleted platform ${A} 2029-01-01\nend 1 2030-01-01T00:00:00Z`,
      'Not an instant',
    ],
    ['with a snapshot that is not an instant', 'end 0 ayer', 'Not an instant'],
  ])('is refused %s', (_name, text, message) => {
    expect(() => parseSweepInput(text)).toThrow(message);
  });
});

describe('the sweep plan', () => {
  it('starts the clock for bytes newly unnamed, and deletes nothing yet', () => {
    const plan = planSweep([key(A), key(B)], named(key(A)), EMPTY_LEDGER, NOW, 120);
    expect(plan.expired).toEqual([]);
    expect(plan.waiting).toEqual([key(B)]);
    expect(plan.ledger.unnamedSince).toEqual({ [key(B)]: NOW.toISOString() });
  });

  it('expires bytes unnamed for longer than the grace period, measured from when they were first seen so', () => {
    const ledger = {
      version: 1 as const,
      unnamedSince: { [key(A)]: daysAgo(121).toISOString(), [key(B)]: daysAgo(119).toISOString() },
    };
    const plan = planSweep([key(A), key(B)], named(), ledger, NOW, 120);
    expect(plan.expired).toEqual([key(A)]);
    expect(plan.waiting).toEqual([key(B)]);
    // The first sighting is kept, not moved forward.
    expect(plan.ledger.unnamedSince[key(A)]).toBe(daysAgo(121).toISOString());
  });

  it('waits from the last deletion of a row that named them, even when the ledger saw them unnamed long before', () => {
    // Day 0: seen unnamed. Day 1: named again by a new upload. Day 30: that row deleted. Day 121: the next run.
    const ledger = { version: 1 as const, unnamedSince: { [key(A)]: daysAgo(121).toISOString() } };
    const input = { named: new Set<string>(), deletedAt: new Map([[key(A), daysAgo(91)]]) };
    const plan = planSweep([key(A)], input, ledger, NOW, 120);
    expect(plan.expired).toEqual([]);
    expect(plan.ledger.unnamedSince[key(A)]).toBe(daysAgo(91).toISOString());
  });

  it('waits from a deletion it never saw happen, even with no ledger at all', () => {
    const input = { named: new Set<string>(), deletedAt: new Map([[key(A), daysAgo(130)]]) };
    // Seen for the first time now: the clock starts now, the later of the two.
    expect(planSweep([key(A)], input, EMPTY_LEDGER, NOW, 120).expired).toEqual([]);
  });

  it('forgets bytes named again, so their clock starts over if they are ever unnamed again', () => {
    const ledger = { version: 1 as const, unnamedSince: { [key(A)]: daysAgo(500).toISOString() } };
    const plan = planSweep([key(A)], named(key(A)), ledger, NOW, 120);
    expect(plan.expired).toEqual([]);
    expect(plan.ledger.unnamedSince).toEqual({});
  });

  it('forgets bytes no longer stored, and reports named bytes the volume lacks', () => {
    const ledger = { version: 1 as const, unnamedSince: { [key(A)]: daysAgo(10).toISOString() } };
    const plan = planSweep([], named(key(B)), ledger, NOW, 120);
    expect(plan.ledger.unnamedSince).toEqual({});
    expect(plan.missing).toEqual([key(B)]);
  });

  it('never runs with a grace period shorter than the oldest restorable dump', () => {
    expect(DEFAULT_GRACE_DAYS).toBeGreaterThanOrEqual(MIN_GRACE_DAYS);
    expect(MIN_GRACE_DAYS).toBeGreaterThanOrEqual(90 + 14);
    expect(() => planSweep([], named(), EMPTY_LEDGER, NOW, MIN_GRACE_DAYS - 1)).toThrow(
      'shorter than the oldest restorable dump',
    );
    expect(() => planSweep([], named(), EMPTY_LEDGER, NOW, MIN_GRACE_DAYS)).not.toThrow();
  });
});

describe('the sweep ledger', () => {
  it('starts empty, and reads back what was written', () => {
    expect(parseLedger(undefined, NOW)).toEqual(EMPTY_LEDGER);
    const ledger = { version: 1, unnamedSince: { [`platform/${A}`]: daysAgo(3).toISOString() } };
    expect(parseLedger(JSON.stringify(ledger), NOW)).toEqual(ledger);
  });

  it.each([
    ['another version', { version: 2, unnamedSince: {} }, 'not one this version wrote'],
    ['no entries at all', { version: 1, unnamedSince: null }, 'not one this version wrote'],
    ['a date that is not one', { version: 1, unnamedSince: { k: 'ayer' } }, 'Not an instant'],
    ['a number for a date', { version: 1, unnamedSince: { k: 0 } }, 'Not an instant'],
    ['a year for a date', { version: 1, unnamedSince: { k: '2001' } }, 'Not an instant'],
    ['a date in the future', { version: 1, unnamedSince: { k: '2031-01-01T00:00:00Z' } }, 'future'],
  ])('refuses %s', (_name, ledger, message) => {
    expect(() => parseLedger(JSON.stringify(ledger), NOW)).toThrow(message);
  });
});
