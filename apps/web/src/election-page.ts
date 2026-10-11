import type {
  PublicCriterion,
  PublicElection,
  PublicParty,
} from '@aiontheballot/domain/public-election';

import { notFound } from 'next/navigation';

import { createElectionLoader } from './election-data';
import { type CellView, cellViews, lastChange } from './election-view';
import { type LoadedSitePage, loadSitePage } from './site-page';

export const loadElection = createElectionLoader({ apiUrl: process.env.API_URL });

export interface ElectionPageParams {
  params: Promise<{ slug: string; locale: string; election: string }>;
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
  // Only an election the home lists reaches the API: a made-up slug is a 404 here, and never crowds the cache out.
  if (!site.page.home.elections.some((listed) => listed.slug === slug)) {
    notFound();
  }
  const result = await loadElection(site.slug, slug);
  if (result.kind === 'missing') {
    notFound();
  }
  if (result.kind === 'unavailable') {
    throw new Error(`The election ${site.slug}/${slug} is unavailable`);
  }
  const { election } = result;
  return { ...site, election, updatedAt: lastChange(election), cell: cellViews(election) };
};
