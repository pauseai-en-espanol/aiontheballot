import type { RoutingConfig, RoutingTable } from '@aiontheballot/domain/routing';

import { INTERNAL_PREFIX, normalizeHost, resolve } from '@aiontheballot/domain/routing';
import { readLimited } from '@aiontheballot/observability/relay';

import { SHARE_NETWORKS } from './share-links';

/**
 * How a site's pages are shared (PLAN R239), counted by the API for the admin, counts only: a click in a share dialog,
 * a visit through a share link (its channel in `utm_source`), and a network's crawler drawing a link preview. Nothing
 * of the visitor is sent but their address, to the API alone, to rate-limit them; the database keeps none of it.
 */

export type ShareEvent = 'share' | 'arrival' | 'preview';

/** The dialog's own actions, beside the networks' links. */
export const SHARE_ACTIONS = ['copy', 'native', 'download', 'image'] as const;
export type ShareAction = (typeof SHARE_ACTIONS)[number];

/** Each event's channels, as the API and the database take them. */
const CHANNELS: Record<'share' | 'arrival', readonly string[]> = {
  share: [...SHARE_NETWORKS, ...SHARE_ACTIONS],
  arrival: SHARE_NETWORKS,
};

/**
 * The crawlers that draw a link preview when a link is pasted, by their user agents: a sign the link was shared there.
 * Search engines and AI crawlers are not among them.
 */
const PREVIEW_CRAWLERS: readonly [channel: string, pattern: RegExp][] = [
  ['whatsapp', /\bWhatsApp\//],
  ['telegram', /\bTelegramBot\b/],
  ['x', /\bTwitterbot\b/],
  ['facebook', /\bfacebookexternalhit\b|\bFacebot\b/],
  ['linkedin', /\bLinkedInBot\b/],
  ['bluesky', /\bBluesky Cardyb\b|\bcardyb\b/i],
  ['slack', /\bSlackbot-LinkExpanding\b|\bSlack-ImgProxy\b/],
  ['discord', /\bDiscordbot\b/],
  [
    'other',
    /\bMastodon\/|\bSkypeUriPreview\b|\bIframely\b|\bEmbedly\b|\bredditbot\b|\bSignal\b|\bViber\b/,
  ],
];

/** Which network's crawler is asking, if one that draws link previews is. */
export const previewChannel = (userAgent: string | null): string | undefined =>
  userAgent ? PREVIEW_CRAWLERS.find(([, pattern]) => pattern.test(userAgent))?.[0] : undefined;

/**
 * A served page's path inside its site, the same in every language (the app's own route words): `/29n/parties/…`, or
 * `/` for its home. Undefined for anything that is no page: a share image, a logo, an icon, a feed.
 */
export const sitePathOf = (
  internalPath: string,
  slug: string,
  locale: string,
): string | undefined => {
  const prefix = `${INTERNAL_PREFIX}/${slug}/${locale}`;
  if (internalPath !== prefix && !internalPath.startsWith(`${prefix}/`)) {
    return undefined;
  }
  const path = internalPath.slice(prefix.length) || '/';
  return /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/.test(path) &&
    path.length <= 200 &&
    !/^\/(?:[^/]+\/)*(?:og|brand)(?:\/|$)/.test(path)
    ? path
    : undefined;
};

/** The API answers at once; a slow answer is not worth waiting for. */
const API_TIMEOUT_MS = 2_000;

export interface ShareCountOptions {
  apiUrl: string | undefined;
  fetch?: typeof fetch;
}

/** Sends one count to the API, for the site's page. Never throws: a lost count is no visitor's problem. */
export const sendShareCount = async (
  slug: string,
  count: { path: string; event: ShareEvent; channel: string },
  visitor: string,
  { apiUrl, fetch: send = globalThis.fetch }: ShareCountOptions,
): Promise<void> => {
  if (!apiUrl) {
    return;
  }
  try {
    await send(new URL(`/public/tenants/${encodeURIComponent(slug)}/shares`, apiUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-visitor-address': visitor },
      body: JSON.stringify(count),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    // Nothing to do: the count is lost, the page is not.
  }
};

/** The visitor's address: the last `X-Forwarded-For` entry, the one the gateway adds; only for the API's rate limit. */
export const visitorOf = (headers: Headers): string =>
  headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';

/** A browser's event: the page's address, the event and its channel. */
const EVENT_MAX_BYTES = 2048;

const reply = (status: number): Response =>
  new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export interface RelayShareOptions extends ShareCountOptions {
  table: RoutingTable | undefined;
  config: RoutingConfig;
}

/**
 * The share relay at /_relay/shares (PLAN R239): a page's own script sends `{ u, event, channel }` when someone shares
 * it from its dialog, or arrives through a share link. The site and the page come from the address, resolved as the
 * proxy resolves a request (the preview's are never counted); the request must come from that page's own host.
 */
export const relayShare = async (
  request: Request,
  options: RelayShareOptions,
): Promise<Response> => {
  if (!options.table) {
    return reply(503);
  }
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  if (Number(request.headers.get('content-length') ?? 0) > EVENT_MAX_BYTES) {
    return reply(413);
  }
  let fields: Record<string, unknown>;
  try {
    const body = await readLimited(request.body, EVENT_MAX_BYTES);
    if (!body) {
      return reply(413);
    }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return reply(400);
    }
    fields = parsed as Record<string, unknown>;
  } catch {
    return reply(400);
  }
  const { u, event, channel } = fields;
  if (
    typeof u !== 'string' ||
    !URL.canParse(u) ||
    (event !== 'share' && event !== 'arrival') ||
    typeof channel !== 'string' ||
    !CHANNELS[event].includes(channel)
  ) {
    return reply(400);
  }
  const page = new URL(u);
  // The host as the router reads it (lowercase, without a port), as a gateway may pass it either way.
  if (
    !host ||
    normalizeHost(page.host) !== normalizeHost(host) ||
    (origin !== null && origin !== page.origin)
  ) {
    return reply(403);
  }
  const resolution = resolve(
    { host: page.host, path: page.pathname, search: '' },
    options.table,
    options.config,
  );
  if (resolution.kind !== 'serve' || resolution.preview) {
    return reply(404);
  }
  const path = sitePathOf(resolution.internalPath, resolution.tenant.slug, resolution.locale);
  if (!path) {
    return reply(404);
  }
  await sendShareCount(
    resolution.tenant.slug,
    { path, event, channel },
    visitorOf(request.headers),
    options,
  );
  return reply(204);
};
