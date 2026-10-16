import { describe, expect, it } from 'vitest';

import { auditFilter } from './audit.js';

describe('the audit filter (H3.3; R150)', () => {
  it("takes whole days in UTC: from the first one's start to the next day after the last", () => {
    expect(auditFilter('t', { from: '2030-01-31', to: '2030-02-28' })).toEqual({
      tenantId: 't',
      from: '2030-01-31T00:00:00Z',
      until: '2030-03-01T00:00:00.000Z',
    });
  });

  it("leaves out a day that isn't one, rather than one JavaScript rolls over", () => {
    expect(auditFilter('t', { from: '2026-02-31', to: '2026-13-01' })).toEqual({ tenantId: 't' });
  });

  it('passes the other filters as given', () => {
    expect(auditFilter(null, { actor: 'a', table: 'parties', row: 'r', before: '12' })).toEqual({
      tenantId: null,
      actorId: 'a',
      table: 'parties',
      rowId: 'r',
      before: '12',
    });
  });
});
