import { notFound, redirect } from 'next/navigation';

// Relative, not `@/`, so a unit test can resolve them.
import { getFromApi } from '../../../../../api';
import {
  fetchFromWeb,
  PREVIEW_HEADERS,
  previewConfig,
  previewHtml,
  previewLocation,
  previewRoot,
} from '../../../../../preview';
import { forwardedRequest } from '../../../../../session';

type Params = { params: Promise<{ tenant: string; path?: string[] }> };

/** A slug as the API takes it; anything else is no site. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * A path segment of the public site: words, numbers, dashes and dots, as its addresses are, but never `.` or `..`,
 * which would leave the site's path (Next resolves them before routing; this doesn't rely on it).
 */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

/**
 * A site's preview (ADR-0005, PLAN R174): every page of the public site as if it were open, never indexed, for the site's
 * members (any role) and platform admins, as the API decides for every admin page; anyone else gets 404, and someone
 * signed out the sign-in page. Fetched from the web app inside the cluster and served sandboxed and script-free.
 */
export const GET = async (request: Request, { params }: Params): Promise<Response> => {
  const config = previewConfig();
  const { tenant, path = [] } = await params;
  if (!config || !SLUG.test(tenant) || !path.every((segment) => SEGMENT.test(segment))) {
    notFound();
  }
  // Who may open the site: the API's answer, as for every admin page.
  const access = await getFromApi(`/api/t/${tenant}`, await forwardedRequest());
  if (access.status === 401) {
    redirect('/sign-in');
  }
  if (access.status !== 200) {
    notFound();
  }
  const root = previewRoot(tenant);
  const search = new URL(request.url).search;
  const answer = await fetchFromWeb(
    config,
    `/${tenant}${path.length > 0 ? `/${path.join('/')}` : ''}${search}`,
    { root, acceptLanguage: request.headers.get('accept-language') },
  );
  if (answer.status >= 300 && answer.status < 400) {
    const location = previewLocation(answer.headers.location ?? null, root);
    if (!location) {
      notFound();
    }
    return new Response(null, { status: answer.status, headers: { ...PREVIEW_HEADERS, location } });
  }
  const type = answer.headers['content-type'] ?? 'application/octet-stream';
  const body = type.startsWith('text/html')
    ? previewHtml(answer.body.toString('utf8'))
    : new Uint8Array(answer.body);
  return new Response(body, {
    status: answer.status,
    headers: { ...PREVIEW_HEADERS, 'content-type': type },
  });
};
