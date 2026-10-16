import { describe, expect, it } from 'vitest';

import { leavesPage } from './leave-guard';

const HERE = 'https://admin.example.test/t/a/e/b/cells/p/c';
const click = (href: string | null, more: Partial<Parameters<typeof leavesPage>[0]> = {}) =>
  leavesPage({ href, target: '', download: false, button: 0, modified: false, ...more }, HERE);

describe('a click that would leave unsaved edits (admin forms §2, PLAN R190)', () => {
  it('is a link to another page of the admin, or anywhere else, in this tab', () => {
    expect(click('/t/a/e/b/cells')).toBe(true);
    expect(click('https://example.org/')).toBe(true);
    expect(click(`${HERE}?tab=2`)).toBe(true);
  });

  it("is not a link to a place on this page, one that opens elsewhere, or a click that isn't a plain one", () => {
    expect(click('#quotes')).toBe(false);
    expect(click(`${HERE}#history`)).toBe(false);
    expect(click(null)).toBe(false);
    expect(click('/t/a', { target: '_blank' })).toBe(false);
    expect(click('/t/a', { download: true })).toBe(false);
    expect(click('/t/a', { button: 1 })).toBe(false);
    expect(click('/t/a', { modified: true })).toBe(false);
  });
});
