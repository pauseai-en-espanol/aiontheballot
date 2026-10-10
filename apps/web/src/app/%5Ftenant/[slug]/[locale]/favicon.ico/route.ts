import { siteIconHash } from '@aiontheballot/og/site-icon';

import { matchesEtag, plain } from '@/http-cache';
import { faviconIco, isSiteIconSettled, siteIconSource } from '@/site-icon';
import { loadTenantPage } from '@/tenant-data';

interface FaviconContext {
  params: Promise<{ slug: string; locale: string }>;
}

/** A day: /favicon.ico has no hash in its name, so a new icon must be able to replace it. */
const A_DAY = 'public, max-age=86400';
/** A minute, while the tenant's own icon can't be read and the default only stands in. */
const A_MINUTE = 'public, max-age=60';

/**
 * /favicon.ico on the tenant's hostname, for the clients that ask for it by name: the 16, 32 and 48 px icons the
 * pages name by hash, in one file.
 */
export const GET = async (request: Request, { params }: FaviconContext): Promise<Response> => {
  const { slug } = await params;
  const page = await loadTenantPage(slug);
  if (page.kind === 'missing') {
    return plain(404, 'Not found');
  }
  if (page.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  const source = await siteIconSource(slug, page.home);
  const cache = isSiteIconSettled(page.home) ? A_DAY : A_MINUTE;
  const etag = `"${siteIconHash(source, 'ico')}"`;
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': cache } });
  }
  const ico = await faviconIco(slug, source);
  return new Response(ico.slice().buffer, {
    headers: {
      'content-type': 'image/x-icon',
      'content-length': String(ico.byteLength),
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
      etag,
    },
  });
};
