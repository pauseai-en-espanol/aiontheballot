import type { Cell } from './data';

/**
 * What submitting a draft needs (editorial workflow C5.2), as the editor fills it: the database's own conditions,
 * `assessment_trail` and `submitted_evidence_rules`, in the order a form reads. The database decides again on submit;
 * this only says what is missing first.
 */

export type SubmitNeed =
  | 'changeKind'
  | 'publicNote'
  | 'noRating'
  | 'rating'
  | 'summary'
  | 'quote'
  | 'checkedDocument'
  | 'quotesMatched'
  | 'checkedKinds';

export interface SubmitItem {
  need: SubmitNeed;
  done: boolean;
}

type ChecklistCell = Pick<Cell, 'party' | 'sources' | 'requireSecondReviewer'> & {
  draft: NonNullable<Cell['draft']>;
};
type Draft = NonNullable<Cell['draft']>;

/**
 * Whether a quote's attestation will lapse (PLAN R167): while four-eyes is on, its attester wrote the quote, or has
 * worked on or uploaded part of the draft since. The database drops it at the quote's next update, publishing's
 * re-check included, so it doesn't count as attested here.
 */
export const attestationLapses = (
  draft: Pick<Draft, 'contributors' | 'uploaders'>,
  requireSecondReviewer: boolean,
  quote: Draft['quotes'][number],
): boolean =>
  requireSecondReviewer &&
  quote.matchStatus === 'attested' &&
  quote.attestedBy !== null &&
  (quote.attestedBy === quote.createdBy ||
    draft.contributors.includes(quote.attestedBy) ||
    draft.uploaders.includes(quote.attestedBy));

const hasText = (value: Record<string, string> | null, locale: string): boolean =>
  (value?.[locale] ?? '').trim() !== '';

export const submitChecklist = (cell: ChecklistCell, defaultLocale: string): SubmitItem[] => {
  const { draft, sources, party } = cell;
  const source = (id: string) => sources.find((s) => s.id === id);
  const items: SubmitItem[] = [];
  // After the first publish, every change says what kind it is and why, in the site's main language.
  if (draft.generation > 0) {
    items.push(
      {
        need: 'changeKind',
        done:
          draft.changeKind === 'update' ||
          draft.changeKind === 'correction' ||
          draft.changeKind === 'withdrawal',
      },
      { need: 'publicNote', done: hasText(draft.publicNote, defaultLocale) },
    );
  }
  if (draft.changeKind === 'withdrawal') {
    // A withdrawal takes the rating down: it needs none, and no summary or evidence of its own.
    items.push({ need: 'noRating', done: draft.rating === null });
  } else {
    items.push(
      { need: 'rating', done: draft.rating !== null },
      { need: 'summary', done: hasText(draft.summary, defaultLocale) },
    );
    if (draft.rating === 'not_mentioned') {
      items.push({
        need: 'checkedDocument',
        done: draft.checkedDocuments.some((checked) => {
          const found = source(checked.source.id);
          return (
            found !== undefined &&
            found.partyId === party.id &&
            found.citable &&
            found.admittedForChecks
          );
        }),
      });
    } else {
      items.push({ need: 'quote', done: draft.quotes.length > 0 });
    }
  }
  // Whatever the rating, every quote and checked document already there must pass.
  if (draft.quotes.length > 0) {
    items.push({
      need: 'quotesMatched',
      done: draft.quotes.every(
        (quote) =>
          (quote.matchStatus === 'matched' ||
            (quote.matchStatus === 'attested' &&
              !attestationLapses(draft, cell.requireSecondReviewer, quote))) &&
          (source(quote.source.id)?.admittedForQuotes ?? false),
      ),
    });
  }
  if (draft.checkedDocuments.length > 0) {
    items.push({
      need: 'checkedKinds',
      done: draft.checkedDocuments.every(
        (checked) => source(checked.source.id)?.listedForChecks ?? false,
      ),
    });
  }
  return items;
};

/**
 * Whether a "not mentioned" draft rests only on replaced documents (D20, PLAN R187): every document it was checked
 * against has been marked replaced since, so the rating says nothing about the newer version. A warning only: the
 * database takes it, as decided (an editor checks the new version, or not).
 */
export const checkedOnlyReplaced = (cell: Pick<Cell, 'draft' | 'sources'>): boolean => {
  const { draft, sources } = cell;
  if (draft?.rating !== 'not_mentioned' || draft.checkedDocuments.length === 0) {
    return false;
  }
  return draft.checkedDocuments.every(
    (checked) => sources.find((source) => source.id === checked.source.id)?.replaced === true,
  );
};
