import { siteIconHash } from '@aiontheballot/og/site-icon';

import { IMMUTABLE, matchesEtag, plain } from '@/http-cache';
import { parseSiteIconFile, siteIconPath, siteIconPng, siteIconSource } from '@/site-icon';
import { loadTenantPage, type TenantPage } from '@/tenant-data';

interface SiteIconContext {
  params: Promise<{ slug: string; locale: string; file: string }>;
}

const current = async (slug: string, page: TenantPage) =>
  page.kind === 'found' ? siteIconSource(slug, page.home) : undefined;

/**
 * The tenant's site icon at /brand/icon/{size}.{hash}.png, relative to its root. As for share images, only the
 * current hash is drawn: an outdated or made-up one redirects to the current icon and draws nothing.
 */
export const GET = async (request: Request, { params }: SiteIconContext): Promise<Response> => {
  const { slug, file } = await params;
  const requested = parseSiteIconFile(file);
  if (!requested) {
    return plain(404, 'Not found');
  }
  let page = await loadTenantPage(slug);
  let source = await current(slug, page);
  if (source && siteIconHash(source, requested.size) !== requested.hash) {
    // The page that named it may hold newer data than this server's copy: refetch before redirecting.
    page = await loadTenantPage(slug, { fresh: true });
    source = await current(slug, page);
  }
  if (page.kind === 'missing') {
    return plain(404, 'Not found');
  }
  if (page.kind === 'unavailable' || !source) {
    return plain(503, 'Service unavailable');
  }
  const hash = siteIconHash(source, requested.size);
  if (requested.hash !== hash) {
    return new Response(null, {
      status: 307,
      headers: {
        location: `${page.base}${siteIconPath(source, requested.size)}`,
        'cache-control': 'public, max-age=60',
      },
    });
  }
  const etag = `"${hash}"`;
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': IMMUTABLE } });
  }
  const png = await siteIconPng(slug, source, requested.size);
  return new Response(png.slice().buffer, {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.byteLength),
      'cache-control': IMMUTABLE,
      'x-content-type-options': 'nosniff',
      etag,
    },
  });
};
