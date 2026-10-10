import { isLocale } from '@aiontheballot/i18n/messages';

import { loadBrandImage, parseBrandImageFile } from '@/brand-images';
import { loadTenantPage, type TenantPage } from '@/tenant-data';

interface BrandImageContext {
  params: Promise<{ slug: string; locale: string; file: string }>;
}

const plain = (status: number, body: string): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });

/**
 * One of the tenant's brand images, at /brand/{sha256}.{ext}: only one its home data names, so the URL can't reach
 * anything else. The bytes never change under a hash, so they are cached for a year as immutable.
 */
export const GET = async (request: Request, { params }: BrandImageContext): Promise<Response> => {
  const { slug, locale, file } = await params;
  const requested = parseBrandImageFile(file);
  if (!requested || !isLocale(locale)) {
    return plain(404, 'Not found');
  }
  const shows = (page: TenantPage) =>
    page.kind === 'found' &&
    Object.values(page.home.brand).some(
      (image) => image.sha256 === requested.sha256 && image.contentType === requested.contentType,
    );
  let page = await loadTenantPage(slug);
  if (!shows(page) && page.kind !== 'unavailable') {
    // A logo just changed on another server: refetch (at most once per tenant every 5 seconds) before a 404.
    page = await loadTenantPage(slug, { fresh: true });
  }
  if (page.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  if (!shows(page)) {
    return plain(404, 'Not found');
  }
  const etag = `"${requested.sha256}"`;
  const headers = {
    etag,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  };
  if (
    request.headers
      .get('if-none-match')
      ?.split(',')
      .some((tag) => tag.trim() === etag)
  ) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = await loadBrandImage(slug, requested.sha256);
  return new Response(bytes.slice().buffer, {
    headers: {
      ...headers,
      'content-type': requested.contentType,
      'content-length': String(bytes.byteLength),
    },
  });
};
