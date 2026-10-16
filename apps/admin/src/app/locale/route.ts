import { isLocale } from '@aiontheballot/i18n/catalog';
import { readLimited } from '@aiontheballot/observability/relay';

// Relative, not `@/`, so its unit test resolves it.
import { backTo, LOCALE_COOKIE } from '../../locale';

/** A year: a language is a lasting preference. */
const MAX_AGE = 365 * 24 * 60 * 60;
/** A language and a path; anyone may post here, so nothing larger is read. */
const MAX_BYTES = 4096;

const reply = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers: { 'cache-control': 'no-store', ...headers } });

// The admin's own pages only: browsers say so in Sec-Fetch-Site, and the few that don't send an Origin with a post.
const fromThisSite = (request: Request): boolean => {
  const site = request.headers.get('sec-fetch-site');
  if (site !== null) {
    return site === 'same-origin';
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  return origin !== null && host !== null && URL.canParse(origin) && new URL(origin).host === host;
};

/**
 * The admin's language switch (editorial workflow §2.7): a form posts the language and the page to go back to, and the
 * answer keeps the choice in a cookie and goes back there. Works without scripts. Only the admin's own pages may post:
 * another site could only change someone's language, but nothing here needs one.
 */
export const POST = async (request: Request): Promise<Response> => {
  if (!fromThisSite(request)) {
    return reply(403);
  }
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') {
    return reply(415);
  }
  const body = await readLimited(request.body, MAX_BYTES);
  if (!body) {
    return reply(413);
  }
  const form = new URLSearchParams(new TextDecoder().decode(body));
  const locale = form.get('locale');
  if (!isLocale(locale)) {
    return reply(400);
  }
  return reply(303, {
    location: backTo(form.get('back')),
    'set-cookie': `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Lax`,
  });
};
