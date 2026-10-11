import { readLimited } from '@aiontheballot/observability/relay';

import { isSignupOutcome, SIGNUP_ANCHOR, type SignupOutcome } from './signup-outcomes';

/** An address and a box, or a token: anyone may post here, so nothing larger is read. */
const MAX_BYTES = 4096;
/** The API answers before it sends any email, so a slow answer is a fault. */
const API_TIMEOUT_MS = 5_000;

export interface SignupTarget {
  slug: string;
  locale: string;
  /** Root-relative links on this host, in the site's words and this locale. */
  hrefs: { home: string; confirm: string; unsubscribe: string };
}

export interface SignupRouteOptions {
  apiUrl: string | undefined;
  fetch?: typeof fetch;
}

const reply = (
  status: number,
  headers: Record<string, string> = {},
  body: string | null = null,
): Response =>
  new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers },
  });

const back = (location: string): Response => reply(303, { location });

/** The page's own forms: browsers say so in Sec-Fetch-Site, and the few that don't send an Origin with a post. */
const fromThisSite = (request: Request): boolean => {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    return site === 'same-origin';
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  return origin !== null && host !== null && URL.canParse(origin) && new URL(origin).host === host;
};

/** The visitor's address: the last `X-Forwarded-For` entry, the one the gateway adds; only to count their signups. */
const visitorOf = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';

/**
 * The signup list's form target (public-site spec §6), `/avisos` (`/updates`), answering with a redirect back to the
 * page it came from, so it works without scripts:
 *
 * - a mail client's one-click unsubscribe (RFC 8058): `?action=unsubscribe&t=…`, a body of `List-Unsubscribe=One-Click`,
 *   from no page at all, so from anywhere; it can only delete;
 * - from the site's own pages only: signing up (the home's form), confirming and unsubscribing (their pages' buttons).
 *
 * Tokens leave the address bar once used: the answers redirect without them.
 */
export const handleSignupPost = async (
  request: Request,
  { slug, locale, hrefs }: SignupTarget,
  { apiUrl, fetch: fetchImpl = fetch }: SignupRouteOptions,
): Promise<Response> => {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const body = await readLimited(request.body, MAX_BYTES);
  if (!body) {
    return reply(413);
  }
  const text = new TextDecoder().decode(body);
  const query = new URL(request.url).searchParams;

  const api = async (
    path: string,
    payload: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    if (!apiUrl) {
      return { status: 503, json: {} };
    }
    try {
      const response = await fetchImpl(new URL(path, apiUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-visitor-address': visitorOf(request) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: response.status, json };
    } catch {
      return { status: 503, json: {} };
    }
  };

  // RFC 8058 sends the form as urlencoded or multipart; either way, its one field says One-Click.
  if (query.get('action') === 'unsubscribe' && /List-Unsubscribe[\s\S]*One-Click/u.test(text)) {
    const { status } = await api(
      `/public/tenants/${encodeURIComponent(slug)}/signups/unsubscribe`,
      {
        token: query.get('t') ?? '',
      },
    );
    return reply(status === 200 ? 200 : 503, { 'content-type': 'text/plain; charset=utf-8' }, '');
  }

  if (!fromThisSite(request)) {
    return reply(403);
  }
  if (type !== 'application/x-www-form-urlencoded') {
    return reply(415);
  }
  const form = new URLSearchParams(text);
  const action = form.get('action');

  if (action === 'confirm' || action === 'unsubscribe') {
    const { status, json } = await api(
      `/public/tenants/${encodeURIComponent(slug)}/signups/${action}`,
      {
        token: form.get('t') ?? '',
      },
    );
    const done = action === 'confirm' ? json.confirmed : json.unsubscribed;
    const result = status === 200 ? (done === true ? 'ok' : 'invalid') : 'failed';
    return back(`${action === 'confirm' ? hrefs.confirm : hrefs.unsubscribe}?r=${result}`);
  }

  const { status, json } = await api(`/public/tenants/${encodeURIComponent(slug)}/signups`, {
    email: form.get('email') ?? '',
    locale,
    futureElections: form.get('future') === '1',
  });
  const outcome: SignupOutcome = isSignupOutcome(json.outcome)
    ? json.outcome
    : json.outcome === 'not-found' || json.error === 'unavailable'
      ? 'unavailable'
      : status === 429
        ? 'limit'
        : status === 400
          ? 'invalid'
          : 'failed';
  return back(`${hrefs.home}?aviso=${outcome}#${SIGNUP_ANCHOR}`);
};
