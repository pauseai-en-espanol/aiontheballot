import type { ShareSize } from '@aiontheballot/og/sizes';

import { isLocale, type Locale } from '@aiontheballot/i18n/messages';

import { homeImage } from '@/home-image';
import { IMMUTABLE, matchesEtag, plain } from '@/http-cache';
import {
  homeCardContent,
  homeCardHash,
  imagePath,
  pageUrl,
  parseImageFile,
  type ShareTemplate,
} from '@/share';
import { loadTenantPage, type TenantPage } from '@/tenant-data';

interface ImageContext {
  params: Promise<{ slug: string; locale: string; file: string }>;
}

/** The image's current content and hash, and its address, from the tenant's data. */
const currentImage = (
  page: Extract<TenantPage, { kind: 'found' }>,
  locale: Locale,
  requested: { template: ShareTemplate; size: ShareSize },
) => {
  const card = homeCardContent(page.home, locale, page.base);
  const hash = homeCardHash(card, requested.size);
  const url = pageUrl(
    page.base,
    locale,
    page.home.tenant.defaultLocale,
    imagePath(requested.template, requested.size, hash),
  );
  return { card, hash, url };
};

/**
 * A tenant's share image, at /og/{template}.{size}.{hash}.png under the page's locale root. Only the current
 * content hash is rendered: an outdated or made-up one redirects to the current image and renders nothing, so
 * requests can't make the server render arbitrary pictures.
 */
export const GET = async (request: Request, { params }: ImageContext): Promise<Response> => {
  const { slug, locale, file } = await params;
  const requested = parseImageFile(file);
  if (!requested || !isLocale(locale)) {
    return plain(404, 'Not found');
  }
  let page = await loadTenantPage(slug);
  let current = page.kind === 'found' ? currentImage(page, locale, requested) : undefined;
  if (current && current.hash !== requested.hash) {
    // The page that named this image may have newer data than this server's copy: refetch before redirecting, so
    // servers with copies of different ages can't send a crawler back and forth.
    page = await loadTenantPage(slug, { fresh: true });
    current = page.kind === 'found' ? currentImage(page, locale, requested) : undefined;
  }
  if (page.kind === 'missing') {
    return plain(404, 'Not found');
  }
  if (page.kind === 'unavailable' || !current) {
    return plain(503, 'Service unavailable');
  }
  const { card, hash, url } = current;
  if (requested.hash !== hash) {
    // Temporary and short-lived: the current image changes whenever the content does.
    return new Response(null, {
      status: 307,
      headers: { location: url, 'cache-control': 'public, max-age=60' },
    });
  }
  const etag = `"${hash}"`;
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': IMMUTABLE } });
  }
  const png = await homeImage(slug, locale, requested.size, hash, card);
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
