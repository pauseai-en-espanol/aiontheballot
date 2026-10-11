import { isLocale } from '@aiontheballot/i18n/messages';
import { connection } from 'next/server';

import { loadElection } from '@/election-page';
import { siteContext } from '@/site';
import { electionEntries, renderSitemap, type SitemapEntry } from '@/sitemap';
import { loadTenantPage } from '@/tenant-data';

interface Context {
  params: Promise<{ slug: string; locale: string }>;
}

const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });

/**
 * A site's sitemap (public-site spec §8), at its root only: the home and the always-on pages, and once the site shows
 * its elections, every page of each. Nothing the site doesn't serve in its mode.
 */
export const GET = async (_request: Request, { params }: Context): Promise<Response> => {
  await connection();
  const { slug, locale } = await params;
  const page = await loadTenantPage(slug);
  if (!isLocale(locale) || page.kind !== 'found' || locale !== page.tenant.defaultLocale) {
    return notFound();
  }
  const { mode } = await siteContext();
  const { documents, elections } = page.home;
  const entries: SitemapEntry[] = [
    { target: { page: 'home' } },
    { target: { page: 'legalNotice' } },
    ...(documents.privacy_policy
      ? [
          {
            target: { page: 'privacy' } as const,
            lastModified: documents.privacy_policy.publishedAt,
          },
        ]
      : []),
    ...(documents.about_operator
      ? [{ target: { page: 'about' } as const, lastModified: documents.about_operator.publishedAt }]
      : []),
  ];
  if (mode !== 'coming-soon') {
    for (const election of elections) {
      const result = await loadElection(slug, election.slug);
      if (result.kind === 'found') {
        entries.push(...electionEntries(result.election));
      }
    }
  }
  return new Response(
    renderSitemap(page.base, page.tenant.defaultLocale, page.tenant.enabledLocales, entries),
    {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    },
  );
};
