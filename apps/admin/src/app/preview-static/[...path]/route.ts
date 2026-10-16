import { notFound } from 'next/navigation';

// Relative, not `@/`, so a unit test can resolve it.
import { fetchFromWeb, PREVIEW_ASSET, PREVIEW_HEADERS, previewConfig } from '../../../preview';

type Params = { params: Promise<{ path: string[] }> };

/**
 * The web app's build assets a preview names (ADR-0005, PLAN R174): its stylesheets and fonts, fetched from the web
 * app inside the cluster. They are the public site's own, public on every site's address, so they need no session;
 * nothing but a content-hashed stylesheet or font is passed on.
 */
export const GET = async (_request: Request, { params }: Params): Promise<Response> => {
  const config = previewConfig();
  const { path } = await params;
  const asset = path.join('/');
  if (!config || !PREVIEW_ASSET.test(asset)) {
    notFound();
  }
  const answer = await fetchFromWeb(config, `/_next/static/${asset}`);
  if (answer.status !== 200) {
    notFound();
  }
  return new Response(new Uint8Array(answer.body), {
    headers: {
      ...PREVIEW_HEADERS,
      'content-type': answer.headers['content-type'] ?? 'application/octet-stream',
      // Content-hashed: a name never changes what it holds.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
