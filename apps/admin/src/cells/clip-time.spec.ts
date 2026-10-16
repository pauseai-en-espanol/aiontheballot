import { describe, expect, it } from 'vitest';

import { formatClipTime, parseClipTime } from './clip-time';

describe('a clip time as people write it (admin forms §2, PLAN R196)', () => {
  it('reads seconds, minutes and seconds, and hours, to the millisecond', () => {
    expect(parseClipTime('83')).toBe(83);
    expect(parseClipTime('83,5')).toBe(83.5);
    expect(parseClipTime('1:23')).toBe(83);
    expect(parseClipTime(' 1:23.456 ')).toBe(83.456);
    expect(parseClipTime('1:02:03')).toBe(3723);
    expect(parseClipTime('0:00')).toBe(0);
  });

  it('refuses what no clock says', () => {
    for (const bad of ['', '1:60', '1:60:00', '-5', 'uno', '1:2:3:4', '1.2345', ':30']) {
      expect(parseClipTime(bad)).toBeUndefined();
    }
  });

  it('shows a time as m:ss, h:mm:ss from an hour on, with its milliseconds if any', () => {
    expect(formatClipTime(83)).toBe('1:23');
    expect(formatClipTime(83.5)).toBe('1:23.5');
    expect(formatClipTime(3723.04)).toBe('1:02:03.04');
    expect(formatClipTime(5)).toBe('0:05');
  });

  it('reads back what it shows', () => {
    for (const seconds of [0, 5, 83.5, 599.999, 3723.04, 36000]) {
      expect(parseClipTime(formatClipTime(seconds))).toBe(seconds);
    }
  });
});
