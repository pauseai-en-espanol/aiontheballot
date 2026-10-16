import { describe, expect, it } from 'vitest';

import type { PublicRevision } from './public-election.js';

import { publicHistory } from './public-history.js';

const revision = (
  revisionNo: number,
  changeKind: PublicRevision['changeKind'],
  rating: PublicRevision['rating'] = 'meets',
): PublicRevision => ({
  revisionNo,
  rating,
  summary: rating ? { es: `Resumen ${revisionNo}` } : null,
  changeKind,
  publicNote: changeKind === 'initial' ? null : { es: `Nota ${revisionNo}` },
  publishedAt: `2026-10-0${revisionNo}T10:00:00.000Z`,
  evidence: [],
  checkedDocuments: [],
});

const kept = (revisions: readonly PublicRevision[]) =>
  revisions.map(({ revisionNo, changeKind, publicNote, summary }) => ({
    revisionNo,
    changeKind,
    publicNote,
    summary,
  }));

describe('publicHistory (PLAN R181)', () => {
  it('leaves a history published while public as it is', () => {
    const history = [revision(2, 'correction'), revision(1, 'initial')];
    expect(publicHistory(history.map((r) => ({ revision: r, inPreview: false })))).toEqual(history);
  });

  it('starts from the version the public first saw: the last one published in preview, as the first', () => {
    const history = publicHistory([
      { revision: revision(5, 'correction'), inPreview: false },
      { revision: revision(4, 'update'), inPreview: false },
      { revision: revision(3, 'update'), inPreview: true },
      { revision: revision(2, 'correction'), inPreview: true },
      { revision: revision(1, 'initial'), inPreview: true },
    ]);
    expect(kept(history)).toEqual([
      {
        revisionNo: 3,
        changeKind: 'correction',
        publicNote: { es: 'Nota 5' },
        summary: { es: 'Resumen 5' },
      },
      {
        revisionNo: 2,
        changeKind: 'update',
        publicNote: { es: 'Nota 4' },
        summary: { es: 'Resumen 4' },
      },
      { revisionNo: 1, changeKind: 'initial', publicNote: null, summary: { es: 'Resumen 3' } },
    ]);
  });

  it('shows an election still in preview as its public will first see it: one version', () => {
    const history = publicHistory([
      { revision: revision(2, 'update'), inPreview: true },
      { revision: revision(1, 'initial'), inPreview: true },
    ]);
    expect(kept(history)).toEqual([
      { revisionNo: 1, changeKind: 'initial', publicNote: null, summary: { es: 'Resumen 2' } },
    ]);
  });

  it('shows nothing of a cell withdrawn in preview until it is published again, then that as the first', () => {
    expect(
      publicHistory([
        { revision: revision(2, 'withdrawal', null), inPreview: true },
        { revision: revision(1, 'initial'), inPreview: true },
      ]),
    ).toEqual([]);
    expect(
      kept(
        publicHistory([
          { revision: revision(4, 'correction'), inPreview: false },
          { revision: revision(3, 'update'), inPreview: false },
          { revision: revision(2, 'withdrawal', null), inPreview: true },
          { revision: revision(1, 'initial'), inPreview: true },
        ]),
      ),
    ).toEqual([
      {
        revisionNo: 2,
        changeKind: 'correction',
        publicNote: { es: 'Nota 4' },
        summary: { es: 'Resumen 4' },
      },
      { revisionNo: 1, changeKind: 'initial', publicNote: null, summary: { es: 'Resumen 3' } },
    ]);
  });

  it('carries a cell withdrawn and published again in preview, and none withdrawn twice', () => {
    expect(
      kept(
        publicHistory([
          { revision: revision(3, 'update'), inPreview: true },
          { revision: revision(2, 'withdrawal', null), inPreview: true },
          { revision: revision(1, 'initial'), inPreview: true },
        ]),
      ),
    ).toEqual([
      { revisionNo: 1, changeKind: 'initial', publicNote: null, summary: { es: 'Resumen 3' } },
    ]);
    expect(
      kept(
        publicHistory([
          { revision: revision(5, 'withdrawal', null), inPreview: false },
          { revision: revision(4, 'update'), inPreview: false },
          { revision: revision(3, 'withdrawal', null), inPreview: true },
          { revision: revision(2, 'update'), inPreview: true },
          { revision: revision(1, 'initial'), inPreview: true },
        ]),
      ),
    ).toEqual([
      { revisionNo: 2, changeKind: 'withdrawal', publicNote: { es: 'Nota 5' }, summary: null },
      { revisionNo: 1, changeKind: 'initial', publicNote: null, summary: { es: 'Resumen 4' } },
    ]);
  });

  it('dates the version carried over from preview no earlier than the election went live', () => {
    const history = [{ revision: revision(1, 'initial'), inPreview: true }];
    expect(publicHistory(history, { since: '2026-10-05T00:00:00.000Z' })[0]?.publishedAt).toBe(
      '2026-10-05T00:00:00.000Z',
    );
    // Not before it was published, nor while the election is still in preview.
    expect(publicHistory(history, { since: '2026-09-30T00:00:00.000Z' })[0]?.publishedAt).toBe(
      '2026-10-01T10:00:00.000Z',
    );
    expect(publicHistory(history)[0]?.publishedAt).toBe('2026-10-01T10:00:00.000Z');
  });
});
