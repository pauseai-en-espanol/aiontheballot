import { describe, expect, it } from 'vitest';

import { changedFields, replacedChanges } from './corrections.js';

const update = (id: string, target: string, fields: string[]) => ({
  id,
  action: 'update' as const,
  target,
  fields,
});

describe('which structural changes may be taken out of the log (PLAN R248)', () => {
  it('are those whose every field a later change of the same target changed again', () => {
    expect([
      ...replacedChanges([
        update('3', 'criterion a', ['description']),
        update('2', 'criterion a', ['description', 'title']),
        update('1', 'criterion a', ['description']),
      ]),
    ]).toEqual(['1']);
  });

  it('counts several later changes together, but not those of another target', () => {
    expect([
      ...replacedChanges([
        update('4', 'party b', ['name']),
        update('3', 'party a', ['name']),
        update('2', 'party a', ['website']),
        update('1', 'party a', ['name', 'website']),
      ]),
    ]).toEqual(['1']);
  });

  it('are updates only', () => {
    expect([
      ...replacedChanges([
        update('2', 'party a', ['name']),
        { ...update('1', 'party a', []), action: 'add' as const },
      ]),
    ]).toEqual([]);
  });
});

describe('the fields a change changed', () => {
  it("are its one field, or each of a set's", () => {
    expect(changedFields('title', { es: 'Título' })).toEqual(['title']);
    expect(changedFields(null, { title: { es: 'Título' }, website: null })).toEqual([
      'title',
      'website',
    ]);
    expect(changedFields(null, null)).toEqual([]);
  });
});
