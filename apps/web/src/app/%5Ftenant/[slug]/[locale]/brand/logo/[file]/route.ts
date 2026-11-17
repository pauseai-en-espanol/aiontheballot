import { isLocale } from '@aiontheballot/i18n/messages';
import { shrinkLogo } from '@aiontheballot/og/logo-render';

import { loadBrandImage } from '@/brand-images';
import { IMMUTABLE, matchesEtag, plain } from '@/http-cache';
import { parsePartyLogoFile } from '@/party-logo-path';
import { partyLogoNamed, smallPartyLogos } from '@/party-logos';
import { trustedSiteMode } from '@/preview-guard';
import { loadTenantPage, previewAccess } from '@/tenant-data';

interface SmallLogoContext {
  params: Promise<{ slug: string; locale: string; file: string }>;
}

/**
 * A party's logo, small (PLAN R236), at /brand/logo/{side}-{sha256}.png: only a logo a public election's data names,
 * or in the admin's preview one in preview, as the logo's own route (/brand/{sha256}.{ext}) checks. Drawn once per
 * process at the side asked, or the upload itself where that is smaller or can't be drawn; the same bytes under the
 * same name forever, so cached for a year as immutable.
 */
export const GET = async (request: Request, { params }: SmallLogoContext): Promise<Response> => {
  const { slug, locale, file } = await params;
  const requested = parsePartyLogoFile(file);
  if (!requested || !isLocale(locale)) {
    return plain(404, 'Not found');
  }
  // Parties' logos only where the site shows its elections (open, or the preview host), as its pages do.
  const mode = trustedSiteMode((name) => request.headers.get(name));
  if (mode === 'coming-soon') {
    return plain(404, 'Not found');
  }
  const preview = mode === 'preview';
  let page = await loadTenantPage(slug, { preview });
  let logo = await partyLogoNamed(page, slug, requested.sha256, mode);
  if (page.kind !== 'unavailable' && !logo) {
    // A logo just changed on another server: refetch (at most once per tenant every 5 seconds) before a 404.
    page = await loadTenantPage(slug, { fresh: true, preview });
    logo = await partyLogoNamed(page, slug, requested.sha256, mode);
  }
  if (page.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  if (!logo) {
    return plain(404, 'Not found');
  }
  const etag = `"${requested.side}-${requested.sha256}"`;
  const headers = { etag, 'cache-control': IMMUTABLE, 'x-content-type-options': 'nosniff' };
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const upload = await loadBrandImage(slug, requested.sha256, preview ? previewAccess : undefined);
  const small = await smallPartyLogos()(
    `${preview ? 'preview:' : ''}${slug}/${requested.sha256}/${requested.side}`,
    async () => shrinkLogo(upload, requested.side) ?? new Uint8Array(),
  );
  // A small upload can take fewer bytes than its redrawing: then it is served as it is.
  const [bytes, contentType] =
    small.byteLength > 0 && small.byteLength < upload.byteLength
      ? [small, 'image/png']
      : [upload, logo.contentType];
  return new Response(bytes.slice().buffer, {
    headers: {
      ...headers,
      'content-type': contentType,
      'content-length': String(bytes.byteLength),
    },
  });
};
