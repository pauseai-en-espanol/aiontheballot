import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { PORTS, PREVIEW_TOKEN, PREVIEW_TOKEN_HEADER } from './servers.js';

export interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Sends a request to the e2e web server by its Host header, the way the gateway forwards it: canonical https addresses
 * included, and without resolving `*.localhost`, which browsers do but Node doesn't on every system (Playwright's
 * `request` does resolve it, so tests reach a host by name only through here). Redirects aren't followed. A `form` is
 * sent URL-encoded, a `json` value as JSON.
 */
export const send = (
  method: 'GET' | 'POST',
  url: string,
  {
    headers = {},
    form,
    json,
  }: { headers?: Record<string, string>; form?: Record<string, string>; json?: unknown } = {},
): Promise<Answer> => {
  const { hostname, pathname, search } = new URL(url);
  const body =
    json !== undefined
      ? JSON.stringify(json)
      : form
        ? new URLSearchParams(form).toString()
        : undefined;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method,
        host: '127.0.0.1',
        port: PORTS.web,
        path: `${pathname}${search}`,
        headers: {
          host: hostname,
          // The preview's secret, as the admin sends it (servers.ts); a test's own value replaces it.
          [PREVIEW_TOKEN_HEADER]: PREVIEW_TOKEN,
          ...(body === undefined
            ? {}
            : {
                'content-type':
                  json !== undefined ? 'application/json' : 'application/x-www-form-urlencoded',
                'content-length': String(Buffer.byteLength(body)),
              }),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
};

/** GETs a URL from the e2e web server by its Host header (see `send`). */
export const get = (url: string, headers: Record<string, string> = {}): Promise<Answer> =>
  send('GET', url, { headers });

/** Width and height from a PNG's IHDR chunk. */
export const pngSize = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});
