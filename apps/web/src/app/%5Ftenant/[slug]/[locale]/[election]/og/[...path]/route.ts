import { isLocale } from '@aiontheballot/i18n/messages';

import { electionImage } from '@/election-image';
import { currentElectionImage } from '@/election-images';
import { electionLoader } from '@/election-page';
import { parseElectionImagePath } from '@/election-share';
import { IMMUTABLE, matchesEtag, plain } from '@/http-cache';
import { siteContext } from '@/site';
import { previewAccess } from '@/tenant-data';

interface ImageContext {
  params: Promise<{ slug: string; locale: string; election: string; path: string[] }>;
}

/**
 * An election view's share image (R148), at `/{election}/og/{view}/…/{size}.{hash}.png` under the page's locale
 * root. Only the current content hash is rendered: an outdated or made-up one redirects to the current image and
 * renders nothing, so requests can't make the server render arbitrary pictures. A site that is coming soon has no
 * election images, as it has no election pages (the proxy refuses them too; this says so again). The admin's preview
 * draws them from its own data (PLAN R181): a picture is cached by the hash of what it shows, so one drawn there is the
 * public's only once the public data shows the same.
 */
export const GET = async (request: Request, { params }: ImageContext): Promise<Response> => {
  const { slug, locale, election, path } = await params;
  const requested = parseElectionImagePath(path);
  if (!requested || !isLocale(locale)) {
    return plain(404, 'Not found');
  }
  const { mode } = await siteContext();
  if (mode === 'coming-soon') {
    return plain(404, 'Not found');
  }
  const { view, size } = requested;
  const load = electionLoader(mode);
  const preview = mode === 'preview';
  let current = await currentElectionImage(load, slug, locale, election, view, size, { preview });
  if (current.kind === 'found' && current.hash !== requested.hash) {
    // The page that named this image may have newer data than this server's copy: refetch before redirecting, so
    // servers with copies of different ages can't send a crawler back and forth.
    current = await currentElectionImage(load, slug, locale, election, view, size, {
      fresh: true,
      preview,
    });
  }
  if (current.kind === 'missing') {
    return plain(404, 'Not found');
  }
  if (current.kind === 'unavailable') {
    return plain(503, 'Service unavailable');
  }
  const { content, hash, url } = current;
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
  const png = await electionImage(
    slug,
    locale,
    size,
    hash,
    content,
    preview ? previewAccess : undefined,
  );
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
