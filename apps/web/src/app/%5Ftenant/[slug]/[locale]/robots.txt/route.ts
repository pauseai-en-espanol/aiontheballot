import { connection } from 'next/server';

import { siteContext } from '@/site';
import { loadTenantPage } from '@/tenant-data';

interface Context {
  params: Promise<{ slug: string; locale: string }>;
}

/**
 * A site's robots.txt (public-site spec §8): everything allowed, with its sitemap on the canonical base; nothing on
 * the preview host. A site kept out of search engines allows crawling but names no sitemap: crawlers must fetch its
 * pages to read their `noindex`, which a disallow would hide from them, leaving indexed pages indexed.
 */
export const GET = async (_request: Request, { params }: Context): Promise<Response> => {
  await connection();
  const { slug, locale } = await params;
  const page = await loadTenantPage(slug);
  if (page.kind !== 'found' || locale !== page.tenant.defaultLocale) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  const { mode, indexed } = await siteContext();
  const body =
    mode === 'preview'
      ? 'User-agent: *\nDisallow: /\n'
      : indexed
        ? `User-agent: *\nAllow: /\nSitemap: ${page.base}/sitemap.xml\n`
        : 'User-agent: *\nAllow: /\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
