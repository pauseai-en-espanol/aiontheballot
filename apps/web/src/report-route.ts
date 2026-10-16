import { readLimited } from '@aiontheballot/observability/relay';

/**
 * The right-of-reply form's target (BRIEF §4; PLAN R149), `/{election}/informar/enviar`: from the site's own page only,
 * answering with a redirect back to the form with how it went, so it works without scripts. Nothing of a report is
 * logged; the API checks it again and the database caps each site's reports per day.
 *
 * Spam checks, cheap and silent, so a bot learns nothing from the answer: a field people never see (`website`) must stay
 * empty, and the form must have been open a few seconds (`t`, when the page was served). Either failing is answered as
 * sent, nothing is sent, and the log counts it. A form open for over a day is answered as expired, to send again.
 */

/** A message of 5,000 characters, the rest of the fields, and room for their encoding. */
const MAX_BYTES = 64 * 1024;
const API_TIMEOUT_MS = 5_000;
/** Faster than a person reads and types. */
export const MIN_FILL_MS = 3_000;
/** A page kept open longer than this is sent again from a fresh one: an old timestamp proves nothing. */
const MAX_FILL_MS = 24 * 60 * 60 * 1000;

/** Clocks of two servers may differ by this much: a form "from the future" within it is a fast one, past it a stale one. */
const CLOCK_SKEW_MS = 60_000;

export const REPORT_OUTCOMES = [
  'sent',
  'expired',
  'invalid',
  'links',
  'limit',
  'failed',
  'unavailable',
] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];
export const isReportOutcome = (value: unknown): value is ReportOutcome =>
  (REPORT_OUTCOMES as readonly unknown[]).includes(value);

export interface ReportTarget {
  slug: string;
  election: string;
  /** The form's root-relative address on this host, in the site's words and this locale. */
  formHref: string;
}

export interface ReportRouteOptions {
  apiUrl: string | undefined;
  fetch?: typeof fetch;
  now?: () => number;
}

const reply = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, {
    status,
    headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...headers },
  });

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

/** The visitor's address: the last `X-Forwarded-For` entry, the one the gateway adds; only to count their reports. */
const visitorOf = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const handleReportPost = async (
  request: Request,
  { slug, election, formHref }: ReportTarget,
  { apiUrl, fetch: fetchImpl = fetch, now = Date.now }: ReportRouteOptions,
): Promise<Response> => {
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
  const party = form.get('partido') ?? '';
  const criterion = form.get('criterio') ?? '';
  const cell = SLUG.test(party) && SLUG.test(criterion) ? { party, criterion } : undefined;
  const back = (outcome: ReportOutcome) => {
    const query = new URLSearchParams({
      ...(cell && outcome !== 'sent' ? { partido: party, criterio: criterion } : {}),
      enviado: outcome,
    });
    return reply(303, { location: `${formHref}?${query}#formulario` });
  };

  const opened = Number(form.get('t'));
  const elapsed = now() - opened;
  // A form kept open too long (or stamped by a server whose clock is far off) is a person's, most likely: they're
  // told to send it again from a fresh page, never that it went.
  if (!Number.isFinite(opened) || elapsed > MAX_FILL_MS || elapsed < -CLOCK_SKEW_MS) {
    return back('expired');
  }
  const trap = (form.get('website') ?? '') !== '';
  if (trap || elapsed < MIN_FILL_MS) {
    // As if sent: a bot learns nothing to try again with. Counted in the log, with nothing of the report.
    console.warn(
      `A report was dropped as automated: ${trap ? 'the hidden field' : 'sent too fast'}`,
    );
    return back('sent');
  }
  const kind = form.get('kind');
  if (kind !== 'error_report' && kind !== 'party_response') {
    return back('invalid');
  }
  const optional = (name: string) => {
    const value = form.get(name)?.trim();
    return value ? value.slice(0, 400) : undefined;
  };
  const payload = {
    kind,
    message: (form.get('message') ?? '').slice(0, 10_000),
    election,
    ...cell,
    ...(optional('name') ? { name: optional('name') } : {}),
    ...(optional('email') ? { email: optional('email') } : {}),
    ...(optional('organization') ? { organization: optional('organization') } : {}),
    partyRepresentative: form.get('representative') === '1',
  };
  if (!apiUrl) {
    return back('unavailable');
  }
  let status: number;
  let outcome: unknown;
  try {
    const response = await fetchImpl(
      new URL(`/public/tenants/${encodeURIComponent(slug)}/reports`, apiUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-visitor-address': visitorOf(request) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      },
    );
    status = response.status;
    outcome = ((await response.json().catch(() => ({}))) as { outcome?: unknown }).outcome;
  } catch {
    return back('failed');
  }
  if (status === 202) {
    return back('sent');
  }
  if (outcome === 'links' || outcome === 'limit' || outcome === 'invalid') {
    return back(outcome);
  }
  return back(status === 429 ? 'limit' : status === 400 ? 'invalid' : 'failed');
};
