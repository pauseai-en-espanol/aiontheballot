import type {
  PublicCriterion,
  PublicElection,
  PublicParty,
  PublicRevision,
} from '@aiontheballot/domain/public-election';
import type { RatingDisplay } from '@aiontheballot/ui/ratings';

import { notFound } from 'next/navigation';

import { createElectionLoader } from './election-data';
import { type LoadedSitePage, loadSitePage } from './site-page';

export const loadElection = createElectionLoader({ apiUrl: process.env.API_URL });

export interface ElectionPageParams {
  params: Promise<{ slug: string; locale: string; election: string }>;
}

/** A cell as the public sees it (public-site spec §5): its display state, and its current revision if rated. */
export interface CellView {
  party: PublicParty;
  criterion: PublicCriterion;
  display: RatingDisplay;
  /** The newest revision that holds a rating; undefined while pending or withdrawn. */
  current: PublicRevision | undefined;
  /** Every published revision, newest first. */
  history: PublicRevision[];
}

export interface LoadedElectionPage extends LoadedSitePage {
  election: PublicElection;
  cell: (party: PublicParty, criterion: PublicCriterion) => CellView;
  /** The latest change shown on the page: the newest revision's date, or none yet. */
  updatedAt: string | undefined;
}

/**
 * What an election's pages start from: the site's page, then the election, a 404 unless it is public (live or
 * archived) and the site shows elections (open, or the preview host). The proxy already serves no election page while
 * a site is coming soon; this says so again, in case a route reaches here some other way.
 */
export const loadElectionPage = async (props: ElectionPageParams): Promise<LoadedElectionPage> => {
  const site = await loadSitePage(props);
  if (site.site.mode === 'coming-soon') {
    notFound();
  }
  const { election: slug } = await props.params;
  const result = await loadElection(site.slug, slug);
  if (result.kind === 'missing') {
    notFound();
  }
  if (result.kind === 'unavailable') {
    throw new Error(`The election ${site.slug}/${slug} is unavailable`);
  }
  const { election } = result;
  const cells = new Map(
    election.cells.map((cell) => [`${cell.partyId}:${cell.criterionId}`, cell]),
  );
  const updatedAt = election.cells
    .flatMap((cell) => cell.revisions.map((revision) => revision.publishedAt))
    .sort()
    .at(-1);
  return {
    ...site,
    election,
    updatedAt,
    cell: (party, criterion) => {
      const history = cells.get(`${party.id}:${criterion.id}`)?.revisions ?? [];
      const [latest] = history;
      if (!latest) {
        return { party, criterion, display: 'pending', current: undefined, history };
      }
      if (latest.rating === null) {
        return { party, criterion, display: 'withdrawn', current: undefined, history };
      }
      return { party, criterion, display: latest.rating, current: latest, history };
    },
  };
};
