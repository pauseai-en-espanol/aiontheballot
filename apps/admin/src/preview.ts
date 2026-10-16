import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * Previewing a site through the admin (ADR-0005, PLAN R174): the admin fetches the public site's pages from the web app
 * inside the cluster, on its preview host with the shared token, and serves them under `/t/{slug}/preview/…` to the
 * site's members only, sandboxed and script-free, so no page of the public site ever runs on the admin's origin with a
 * member's session. The public app stays without sessions or cookies; the token alone opens its preview mode.
 */

export interface PreviewConfig {
  /** The web app inside the cluster, e.g. `http://aiontheballot-web:3000`. */
  webUrl: string;
  /** The preview host's name, which no gateway routes. */
  host: string;
  /** The shared secret the web app's preview mode asks for. */
  token: string;
}

/**
 * The shared token as the web app takes it: at least 32 printable ASCII characters with no spaces (a short or mistyped
 * one turns the preview off on both sides rather than failing every request).
 */
const TOKEN = /^[\x21-\x7e]{32,}$/u;

/** The preview's settings, or none: then there is no preview, and its routes answer 404. */
export const previewConfig = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): PreviewConfig | undefined =>
  env.WEB_URL && env.PREVIEW_HOST && env.PREVIEW_TOKEN && TOKEN.test(env.PREVIEW_TOKEN)
    ? { webUrl: env.WEB_URL, host: env.PREVIEW_HOST, token: env.PREVIEW_TOKEN }
    : undefined;

/** Where a site's preview is served on the admin host. */
export const previewRoot = (slug: string): string => `/t/${slug}/preview`;

/** Where the web app's build assets the preview names are served on the admin host (they would clash at `/_next/`). */
export const PREVIEW_STATIC = '/preview-static/';

/**
 * The preview's own policy, over the admin's: `sandbox` runs no script and submits no form (no `allow-scripts`, no
 * `allow-forms`), so even a bug in the public site's pages can't act with the member's session; it loads only the
 * styles, fonts and images the admin serves for it. It keeps the admin's origin (`allow-same-origin`, PLAN R174): with
 * an opaque one, the browser sends no session with the page's own images (the site's logos, behind the same membership
 * check) and refuses its fonts (CORS). Without scripts, keeping the origin lets the page do nothing more than load them.
 */
export const PREVIEW_POLICY = [
  'sandbox allow-same-origin',
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The headers every preview answer carries, the policy included. The admin's own headers (next.config.js) come on top:
 * its `Referrer-Policy: same-origin`, so no other site learns a preview's address.
 */
export const PREVIEW_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': PREVIEW_POLICY,
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
};

/**
 * A preview page's HTML as the admin serves it (ADR-0005's spike, PLAN R174): without its scripts, which the policy
 * would refuse anyway (each refusal a request and a console error for nothing), and with the web app's build assets
 * moved under PREVIEW_STATIC, since on the admin host `/_next/static/` is the admin's own. The CSS names its fonts
 * relatively (`../media/…`), so it needs no change. The HTML is the web app's own, server-rendered: React writes no
 * `</script` inside a script's text.
 */
export const previewHtml = (html: string): string =>
  html
    .replaceAll(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/giu, '')
    .replaceAll(/<link\s[^>]*>/giu, (tag) =>
      /\s(?:as="script"|rel="modulepreload")/iu.test(tag) ? '' : tag,
    )
    .replaceAll('/_next/static/', PREVIEW_STATIC);

/**
 * A redirect from the web app's preview, kept inside the site's preview: a path under its root, as the web app builds
 * them with the root it is given. Anything else (another host, another root) is no place to send a member: undefined.
 */
export const previewLocation = (location: string | null, root: string): string | undefined => {
  if (!location) {
    return undefined;
  }
  return location === root || ['/', '?', '#'].some((next) => location.startsWith(`${root}${next}`))
    ? location
    : undefined;
};

/** A build asset the preview may ask for: a stylesheet or a font (or an image) by its content-hashed name. */
export const PREVIEW_ASSET =
  /^(?:chunks\/[\w.-]+\.css|media\/[\w.-]+\.(?:woff2|woff|ttf|png|jpe?g|webp))$/;

export interface WebAnswer {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

const TIMEOUT_MS = 10_000;
/** A page or an image of the public site: well below this; anything larger is no preview's. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * A GET to the web app inside the cluster, on the preview host with the token, and the root the page's links take.
 * Nothing of the member's request is passed on: no cookie, no address, no header but the language they asked for.
 */
export const fetchFromWeb = (
  config: PreviewConfig,
  path: string,
  { root, acceptLanguage }: { root?: string; acceptLanguage?: string | null } = {},
): Promise<WebAnswer> => {
  const url = new URL(path, config.webUrl);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        headers: {
          host: config.host,
          'x-aiontheballot-preview-token': config.token,
          ...(root ? { 'x-aiontheballot-preview-root': root } : {}),
          ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
        },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new Error('The preview answer is too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const name of ['content-type', 'location']) {
            const value = response.headers[name];
            if (typeof value === 'string') {
              headers[name] = value;
            }
          }
          resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('The web app did not answer in time')));
    request.on('error', reject);
    request.end();
  });
};
