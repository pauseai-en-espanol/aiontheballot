import { describe, expect, it } from 'vitest';

import type { Cell } from './data';

import { checkedOnlyReplaced, submitChecklist } from './checklist';

// Fictional ids and words only.
const PARTY = 'party-a';
const source = (id: string, overrides: Partial<Cell['sources'][number]> = {}) => ({
  id,
  title: `Fuente ${id}`,
  kind: 'pdf',
  language: 'es',
  partyId: PARTY,
  isProgramme: true,
  citable: true,
  admittedForQuotes: true,
  admittedForChecks: true,
  listedForChecks: true,
  ...overrides,
});
const SOURCES = [
  source('programa'),
  source('neutral', { partyId: null, isProgramme: false, admittedForChecks: false }),
  source('video', {
    kind: 'video',
    admittedForQuotes: false,
    listedForChecks: false,
    admittedForChecks: false,
  }),
];

type Draft = NonNullable<Cell['draft']>;
const draft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'cell',
  state: 'draft',
  generation: 0,
  contentVersion: 1,
  rating: null,
  summary: null,
  changeKind: null,
  publicNote: null,
  recheckReason: null,
  reportId: null,
  quotes: [],
  checkedDocuments: [],
  events: [],
  contributors: [],
  uploaders: [],
  ...overrides,
});
const quote = (
  sourceId: string,
  matchStatus: 'unmatched' | 'matched' | 'attested' = 'matched',
) => ({
  id: `q-${sourceId}`,
  ordinal: 1,
  quote: 'Una cita de ejemplo de quince caracteres o más',
  sectionLabel: null,
  source: { id: sourceId, title: 'Fuente', kind: 'pdf', language: 'es' },
  matchStatus,
  location: 'p. 1',
  createdBy: 'persona',
  withText: matchStatus !== 'attested',
  attestationFile: null,
  clip: null,
  attestedBy: matchStatus === 'attested' ? 'otra-persona' : null,
});
const checked = (sourceId: string) => ({
  source: { id: sourceId, title: 'Fuente', kind: 'pdf', language: 'es' },
  checkedAt: '2026-10-01T00:00:00Z',
  checkedBy: 'persona',
});

const check = (d: Draft) =>
  Object.fromEntries(
    submitChecklist(
      {
        party: { id: PARTY } as Cell['party'],
        sources: SOURCES,
        requireSecondReviewer: true,
        draft: d,
      },
      'es',
    ).map((item) => [item.need, item.done]),
  );

describe('submitChecklist (editorial workflow C5.2)', () => {
  it('asks a first draft for a rating, a summary in the main language and a quote', () => {
    expect(check(draft())).toEqual({ rating: false, summary: false, quote: false });
    expect(
      check(
        draft({
          rating: 'meets',
          summary: { en: 'Only in English' },
          quotes: [quote('programa')],
        }),
      ),
    ).toEqual({ rating: true, summary: false, quote: true, quotesMatched: true });
    expect(
      check(draft({ rating: 'meets', summary: { es: 'Resumen' }, quotes: [quote('programa')] })),
    ).toEqual({ rating: true, summary: true, quote: true, quotesMatched: true });
  });

  it("doesn't count an attestation that will lapse: its attester wrote the quote or worked on the draft (R167)", () => {
    const attested = { ...quote('neutral', 'attested'), attestedBy: 'revisora' };
    const base = { rating: 'meets' as const, summary: { es: 'Resumen' } };
    expect(check(draft({ ...base, quotes: [attested] })).quotesMatched).toBe(true);
    expect(
      check(draft({ ...base, quotes: [attested], contributors: ['revisora'] })).quotesMatched,
    ).toBe(false);
    expect(
      check(draft({ ...base, quotes: [attested], uploaders: ['revisora'] })).quotesMatched,
    ).toBe(false);
    expect(
      check(draft({ ...base, quotes: [{ ...attested, createdBy: 'revisora' }] })).quotesMatched,
    ).toBe(false);
  });

  it('wants every quote matched or attested, from a kind the methodology admits', () => {
    const base = { rating: 'meets' as const, summary: { es: 'Resumen' } };
    expect(check(draft({ ...base, quotes: [quote('programa', 'unmatched')] }))).toMatchObject({
      quotesMatched: false,
    });
    expect(check(draft({ ...base, quotes: [quote('video', 'attested')] }))).toMatchObject({
      quotesMatched: false,
    });
    expect(check(draft({ ...base, quotes: [quote('neutral', 'attested')] }))).toMatchObject({
      quotesMatched: true,
    });
  });

  it('backs "not mentioned" with a stored document of the party, of a kind listed for it', () => {
    const base = { rating: 'not_mentioned' as const, summary: { es: 'Resumen' } };
    expect(check(draft(base))).toEqual({ rating: true, summary: true, checkedDocument: false });
    // A party-neutral document may be checked, but doesn't back it on its own.
    expect(check(draft({ ...base, checkedDocuments: [checked('neutral')] }))).toEqual({
      rating: true,
      summary: true,
      checkedDocument: false,
      checkedKinds: true,
    });
    expect(check(draft({ ...base, checkedDocuments: [checked('programa')] }))).toMatchObject({
      checkedDocument: true,
      checkedKinds: true,
    });
    expect(check(draft({ ...base, checkedDocuments: [checked('video')] }))).toMatchObject({
      checkedKinds: false,
    });
  });

  it('asks a later change for its kind and a public note, and a withdrawal for no rating', () => {
    expect(
      check(
        draft({
          generation: 1,
          rating: 'meets',
          summary: { es: 'Resumen' },
          quotes: [quote('programa')],
        }),
      ),
    ).toMatchObject({ changeKind: false, publicNote: false, rating: true });
    expect(
      check(
        draft({
          generation: 1,
          changeKind: 'withdrawal',
          publicNote: { es: 'Nota pública' },
          rating: 'meets',
        }),
      ),
    ).toEqual({ changeKind: true, publicNote: true, noRating: false });
    expect(
      check(draft({ generation: 1, changeKind: 'withdrawal', publicNote: { es: 'Nota' } })),
    ).toEqual({ changeKind: true, publicNote: true, noRating: true });
  });
});

describe('a "not mentioned" checked only against replaced documents (D20, PLAN R187)', () => {
  const replaced = (id: string) => source(id, { replaced: true });
  it('is warned of once every document it was checked against is replaced', () => {
    const sources = [replaced('programa'), source('neutral'), replaced('antiguo')];
    const notMentioned = (ids: string[]) =>
      draft({ rating: 'not_mentioned', checkedDocuments: ids.map(checked) });
    expect(checkedOnlyReplaced({ sources, draft: notMentioned(['programa']) })).toBe(true);
    expect(checkedOnlyReplaced({ sources, draft: notMentioned(['programa', 'antiguo']) })).toBe(
      true,
    );
    // One current document checked is enough, and so is having none at all (the checklist asks for one).
    expect(checkedOnlyReplaced({ sources, draft: notMentioned(['programa', 'neutral']) })).toBe(
      false,
    );
    expect(checkedOnlyReplaced({ sources, draft: notMentioned([]) })).toBe(false);
  });

  it('is never warned of for another rating, or without a draft', () => {
    const sources = [replaced('programa')];
    expect(
      checkedOnlyReplaced({
        sources,
        draft: draft({ rating: 'meets', checkedDocuments: [checked('programa')] }),
      }),
    ).toBe(false);
    expect(checkedOnlyReplaced({ sources, draft: null })).toBe(false);
  });
});
