import type { MethodologyKind } from '@aiontheballot/domain/methodology';
import type {
  PublicCriterion,
  PublicElection,
  PublicMethodology,
  PublicParty,
  PublicRevision,
} from '@aiontheballot/domain/public-election';
import type { RatingDisplay } from '@aiontheballot/ui/ratings';

/** A cell as the public sees it (public-site spec §5): its display state, and its current revision if rated. */
export interface CellView {
  party: PublicParty;
  criterion: PublicCriterion;
  display: RatingDisplay;
  /** The newest revision, if it holds a rating; undefined while pending or withdrawn. */
  current: PublicRevision | undefined;
  /** Every published revision, newest first. */
  history: PublicRevision[];
}

/** Each cell's view: pending without a published revision, withdrawn when the newest one holds no rating. */
export const cellViews = (
  election: PublicElection,
): ((party: PublicParty, criterion: PublicCriterion) => CellView) => {
  const cells = new Map(
    election.cells.map((cell) => [`${cell.partyId}:${cell.criterionId}`, cell]),
  );
  return (party, criterion) => {
    const history = cells.get(`${party.id}:${criterion.id}`)?.revisions ?? [];
    const [latest] = history;
    if (!latest) {
      return { party, criterion, display: 'pending', current: undefined, history };
    }
    if (latest.rating === null) {
      return { party, criterion, display: 'withdrawn', current: undefined, history };
    }
    return { party, criterion, display: latest.rating, current: latest, history };
  };
};

/** The election's latest change: its newest revision's date, or none yet. */
export const lastChange = (election: PublicElection): string | undefined =>
  election.cells
    .flatMap((cell) => cell.revisions.map((revision) => revision.publishedAt))
    .sort()
    .at(-1);

/**
 * The ratings' scale and its wording: the election's methodology's kind, else the site's; for demands, whose they are,
 * when their owner is public. The wording follows the kind, so it always matches the legend.
 */
export const methodologyOf = (
  election: PublicElection,
  siteKind: MethodologyKind,
): { kind: MethodologyKind; owner: PublicMethodology['demandsOwner'] } => {
  const kind = election.methodology?.kind ?? siteKind;
  return { kind, owner: kind === 'demands' ? (election.methodology?.demandsOwner ?? null) : null };
};
