import type { PublicElection } from '@aiontheballot/domain/public-election';
import type { SitePage } from '@aiontheballot/domain/site-paths';

import { correctionsLog } from './corrections-log';
import { pageCanonical } from './site';

export interface SitemapEntry {
  target: SitePage;
  /** An ISO 8601 instant: the latest change shown on the page. */
  lastModified?: string | undefined;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Every page of an election (public-site spec §8): the scorecard, the methodology, each party, criterion and cell. */
export const electionEntries = (election: PublicElection): SitemapEntry[] => {
  const { parties, criteria, cells } = election;
  const latest = (partyId?: string, criterionId?: string) =>
    cells
      .filter(
        (cell) =>
          (!partyId || cell.partyId === partyId) &&
          (!criterionId || cell.criterionId === criterionId),
      )
      .flatMap((cell) => cell.revisions.map((revision) => revision.publishedAt))
      .sort()
      .at(-1);
  const slug = election.election.slug;
  return [
    { target: { page: 'election', election: slug }, lastModified: latest() },
    { target: { page: 'methodology', election: slug } },
    // Its lastModified is its newest entry's, if any.
    {
      target: { page: 'corrections', election: slug },
      lastModified: correctionsLog(election)[0]?.at,
    },
    ...parties.map((party) => ({
      target: { page: 'party', election: slug, party: party.slug } as const,
      lastModified: latest(party.id),
    })),
    ...criteria.map((criterion) => ({
      target: { page: 'criterion', election: slug, criterion: criterion.slug } as const,
      lastModified: latest(undefined, criterion.id),
    })),
    ...parties.flatMap((party) =>
      criteria.map((criterion) => ({
        target: {
          page: 'cell',
          election: slug,
          party: party.slug,
          criterion: criterion.slug,
        } as const,
        lastModified: latest(party.id, criterion.id),
      })),
    ),
  ];
};

/**
 * A sitemap with every page in each of the site's languages (`hreflang` alternates and `x-default`), all on the
 * tenant's canonical base, never the Host header.
 */
export const renderSitemap = (
  base: string,
  defaultLocale: string,
  locales: readonly string[],
  entries: readonly SitemapEntry[],
): string => {
  const url = (locale: string, target: SitePage) =>
    escapeXml(pageCanonical(base, locale, defaultLocale, target));
  const blocks = entries.flatMap(({ target, lastModified }) =>
    locales.map((locale) =>
      [
        '  <url>',
        `    <loc>${url(locale, target)}</loc>`,
        ...(lastModified ? [`    <lastmod>${escapeXml(lastModified)}</lastmod>`] : []),
        ...locales.map(
          (other) =>
            `    <xhtml:link rel="alternate" hreflang="${escapeXml(other)}" href="${url(other, target)}"/>`,
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${url(defaultLocale, target)}"/>`,
        '  </url>',
      ].join('\n'),
    ),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...blocks,
    '</urlset>',
    '',
  ].join('\n');
};
