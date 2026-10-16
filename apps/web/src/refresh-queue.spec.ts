import { describe, expect, it } from 'vitest';

import { createRefreshQueue } from './refresh-queue';

/** A refresh that waits to be let go, recording when each one starts and ends. */
const gated = () => {
  const log: string[] = [];
  const gates: (() => void)[] = [];
  let started = 0;
  const refresh = (key: string) => {
    started += 1;
    const n = started;
    log.push(`start ${key} ${n}`);
    return new Promise<void>((resolve) => {
      gates.push(() => {
        log.push(`end ${key} ${n}`);
        resolve();
      });
    });
  };
  const release = async () => {
    gates.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { log, refresh, release, started: () => started };
};

describe('one refresh at a time per key (R151)', () => {
  it('lets loads join the refresh on its way', async () => {
    const g = gated();
    const queue = createRefreshQueue(g.refresh);
    const first = queue.join('a');
    const second = queue.join('a');
    expect(g.started()).toBe(1);
    await g.release();
    await Promise.all([first, second]);
    void queue.join('a');
    expect(g.started()).toBe(2);
  });

  it('runs a burst of forces as one refresh after the running one, never alongside it', async () => {
    const g = gated();
    const queue = createRefreshQueue(g.refresh);
    const running = queue.join('a');
    const forces = Array.from({ length: 20 }, () => queue.force('a'));
    // The running refresh may have started before what changed: the forces wait for one of their own.
    expect(g.started()).toBe(1);
    await g.release();
    await running;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(g.started()).toBe(2);
    // A force while the follow-up runs gets another after it.
    const later = queue.force('a');
    await g.release();
    await Promise.all(forces);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(g.started()).toBe(3);
    await g.release();
    await later;
    expect(g.log).toEqual(['start a 1', 'end a 1', 'start a 2', 'end a 2', 'start a 3', 'end a 3']);
  });

  it('keeps keys apart, and forgets a key once nothing is on its way', async () => {
    const g = gated();
    const queue = createRefreshQueue(g.refresh);
    const a = queue.force('a');
    const b = queue.force('b');
    expect(g.started()).toBe(2);
    await g.release();
    await g.release();
    await Promise.all([a, b]);
    void queue.force('a');
    expect(g.started()).toBe(3);
  });

  it('goes on after a refresh that failed', async () => {
    let calls = 0;
    const queue = createRefreshQueue(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('down');
      }
    });
    const first = queue.join('a');
    const forced = queue.force('a');
    await expect(first).rejects.toThrow('down');
    await forced;
    expect(calls).toBe(2);
  });
});
