import type { PublicElection } from '@aiontheballot/domain/public-election';

import { isLocale, type Locale } from '@aiontheballot/i18n/messages';
import { LINK_PREVIEW, type ShareSize } from '@aiontheballot/og/sizes';

import type { ElectionResult } from './election-data';
import type { LoadedElectionPage } from './election-page';

import { electionImage, warmElectionImage } from './election-image';
import {
  electionCard,
  type ElectionCardContent,
  electionCardHash,
  electionImagePath,
  type ElectionView,
  electionViews,
  TABLE_SIZES,
} from './election-share';
import { pageUrl } from './share';
import { localePrefix } from './site';
import { loadTenantPage } from './tenant-data';

type ElectionLoader = (
  slug: string,
  election: string,
  options?: { fresh?: boolean },
) => Promise<ElectionResult>;

export type CurrentImage =
  | { kind: 'found'; content: ElectionCardContent; hash: string; url: string }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

/**
 * A view's current image: its card from this server's copy of the site's and the election's data, its hash and its
 * canonical address. Missing for an election the home doesn't list (never reaching the API), or a view it lacks.
 */
export const currentElectionImage = async (
  loadElection: ElectionLoader,
  slug: string,
  locale: Locale,
  electionSlug: string,
  view: ElectionView,
  size: ShareSize,
  { fresh = false, preview = false }: { fresh?: boolean; preview?: boolean } = {},
): Promise<CurrentImage> => {
  // The admin's preview's images from its own data (PLAN R181), with the loader it passes.
  const page = await loadTenantPage(slug, { fresh, preview });
  if (page.kind !== 'found') {
    return page;
  }
  if (!page.home.elections.some((listed) => listed.slug === electionSlug)) {
    return { kind: 'missing' };
  }
  const result = await loadElection(slug, electionSlug, { fresh });
  if (result.kind !== 'found') {
    return result;
  }
  const card = electionCard(
    { home: page.home, base: page.base, locale, election: result.election },
    view,
  );
  if (!card) {
    return { kind: 'missing' };
  }
  const hash = electionCardHash(card.content, size);
  const url = pageUrl(
    page.base,
    locale,
    page.home.tenant.defaultLocale,
    electionImagePath(electionSlug, view, size, hash),
  );
  return { kind: 'found', content: card.content, hash, url };
};

/** Views whose cards a fresh copy always warms: the election's own, its parties' and its criteria's. */
const isListView = (view: ElectionView) => view.view !== 'cell';

/** Lets other work run between two renders: each holds the event loop for tens of milliseconds. */
const yieldToOthers = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Pre-renders the link previews of an election's views whose cards changed (R148), in each of the site's languages,
 * one at a time, so they are ready before anyone shares the pages: called when this server's copy of the election
 * changes. A first copy warms the overview, the methodology, the parties and the criteria; cells, which are many,
 * warm when they change or when their page renders. Only for a site that is open: elsewhere nobody shares them yet.
 */
export const warmChangedElection = async (
  slug: string,
  next: PublicElection,
  previous: PublicElection | undefined,
): Promise<void> => {
  const page = await loadTenantPage(slug);
  if (page.kind !== 'found' || !page.tenant.open) {
    return;
  }
  const { home, base } = page;
  for (const locale of page.tenant.enabledLocales.filter(isLocale)) {
    for (const view of electionViews(next)) {
      const card = electionCard({ home, base, locale, election: next }, view);
      if (!card) {
        continue;
      }
      const hash = electionCardHash(card.content, LINK_PREVIEW);
      const before = previous && electionCard({ home, base, locale, election: previous }, view);
      // A view the previous copy didn't have (a new party) is new; a first copy warms only the lists.
      const changed = before
        ? electionCardHash(before.content, LINK_PREVIEW) !== hash
        : previous !== undefined || isListView(view);
      if (!changed) {
        continue;
      }
      await electionImage(slug, locale, LINK_PREVIEW, hash, card.content).catch((error: unknown) =>
        console.error('Could not pre-render a share image', error),
      );
      await yieldToOthers();
    }
  }
};

/** A page's own share image: its link preview, and the data image to post (R148, PLAN R185). */
export interface PageShare {
  /** For the page's tags: the link preview's path under the locale root, and the image in words. */
  preview: { path: string; alt: string };
  /** For the share links (R177): the page's title, which they say before its address. */
  text: string;
  /**
   * For the share panel: the image with the data, in the shapes people post, each one's address on this host. The
   * page's own card; on the scorecard, the whole table (`table`), whose link preview is the summary (canvas A).
   */
  image: { alt: string; table: boolean; downloads: { size: ShareSize; href: string }[] };
}

/**
 * An election page's share image, from the page's own data: its link preview is rendered now, in the background, so it
 * is ready when the crawler that fetched the page asks for it. Nothing for a view the election lacks.
 */
export const electionPageShare = (
  page: Pick<LoadedElectionPage, 'page' | 'slug' | 'locale' | 'site' | 'election'>,
  view: ElectionView,
): PageShare | undefined => {
  const { home, base } = page.page;
  const card = electionCard({ home, base, locale: page.locale, election: page.election }, view);
  if (!card) {
    return undefined;
  }
  const slug = page.election.election.slug;
  const hash = electionCardHash(card.content, LINK_PREVIEW);
  // Not for the admin's preview: no crawler reads it, and its pictures would only crowd out the public's.
  if (page.site.mode !== 'preview') {
    warmElectionImage(page.slug, page.locale, LINK_PREVIEW, hash, card.content);
  }
  const prefix = `${page.site.root}${localePrefix(page.locale, home.tenant.defaultLocale)}`;
  // Only posted, never a link preview: rendered when someone asks for it. On the scorecard, the whole table.
  const table = view.view === 'overview';
  const posted = table
    ? electionCard({ home, base, locale: page.locale, election: page.election }, { view: 'table' })
    : card;
  const postedView: ElectionView = table ? { view: 'table' } : view;
  return {
    preview: { path: electionImagePath(slug, view, LINK_PREVIEW, hash), alt: card.alt },
    text: card.text,
    image: {
      alt: (posted ?? card).alt,
      table,
      downloads: TABLE_SIZES.map((size) => ({
        size,
        href: `${prefix}${electionImagePath(
          slug,
          postedView,
          size,
          electionCardHash((posted ?? card).content, size),
        )}`,
      })),
    },
  };
};
