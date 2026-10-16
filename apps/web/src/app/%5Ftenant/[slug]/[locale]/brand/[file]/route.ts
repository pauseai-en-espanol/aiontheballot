import { isLocale } from '@aiontheballot/i18n/messages';

import { loadBrandImage, parseBrandImageFile } from '@/brand-images';
import { electionLoader } from '@/election-page';
import { IMMUTABLE, matchesEtag, plain } from '@/http-cache';
import { trustedSiteMode } from '@/preview-guard';
import { type SiteMode } from '@/site-mode';
import { loadTenantPage, previewAccess, type TenantPage } from '@/tenant-data';

interface BrandImageContext {
  params: Promise<{ slug: string; locale: string; file: string }>;
}

/**
 * Whether a party of one of the site's public elections has this logo (PLAN R142): those elections' data is already
 * kept by the web app, so a made-up hash costs no request to the API.
 */
const isPartyLogo = async (
  page: TenantPage,
  slug: string,
  requested: { sha256: string; contentType: string },
  mode: SiteMode,
): Promise<boolean> => {
  if (page.kind !== 'found') {
    return false;
  }
  for (const listed of page.home.elections) {
    const result = await electionLoader(mode)(slug, listed.slug);
    if (
      result.kind === 'found' &&
      result.election.parties.some(
        (party) =>
          party.logo?.sha256 === requested.sha256 &&
          party.logo.contentType === requested.contentType,
      )
    ) {
      return true;
    }
  }
  return false;
};

/**
 * One of the tenant's brand images, or a party's logo, at /brand/{sha256}.{ext}: only one its home data or a public
 * election's data names, so the URL can't reach anything else. The bytes never change under a hash, so they are cached
 * for a year as immutable. The admin's preview checks against its own data, and reads the bytes as the preview's
 * (PLAN R181): a logo of a party of an election in preview, there only.
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
  // Parties' logos only where the site shows its elections (open, or the preview host), as its pages do.
  const mode = trustedSiteMode((name) => request.headers.get(name));
  const preview = mode === 'preview';
  const partyLogos = mode !== 'coming-soon';
  const named = async (candidate: TenantPage) =>
    shows(candidate) || (partyLogos && (await isPartyLogo(candidate, slug, requested, mode)));
  let page = await loadTenantPage(slug, { preview });
  if (page.kind !== 'unavailable' && !(await named(page))) {
    // A logo just changed on another server: refetch (at most once per tenant every 5 seconds) before a 404.
    page = await loadTenantPage(slug, { fresh: true, preview });
    if (page.kind !== 'unavailable' && !(await named(page))) {
      return plain(404, 'Not found');
    }
  }
  if (page.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  const etag = `"${requested.sha256}"`;
  const headers = { etag, 'cache-control': IMMUTABLE, 'x-content-type-options': 'nosniff' };
  if (matchesEtag(request.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = await loadBrandImage(slug, requested.sha256, preview ? previewAccess : undefined);
  return new Response(bytes.slice().buffer, {
    headers: {
      ...headers,
      'content-type': requested.contentType,
      'content-length': String(bytes.byteLength),
    },
  });
};
