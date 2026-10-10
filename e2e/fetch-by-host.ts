import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

import { PORTS } from './servers.js';

export interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * GETs a URL from the e2e web server by its Host header, the way the gateway forwards it: canonical https addresses
 * included, and without resolving `*.localhost`, which browsers do but Node doesn't on every system.
 */
export const get = (url: string, headers: Record<string, string> = {}): Promise<Answer> => {
  const { hostname, pathname, search } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: PORTS.web,
        path: `${pathname}${search}`,
        headers: { host: hostname, ...headers },
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
    req.end();
  });
};

/** Width and height from a PNG's IHDR chunk. */
export const pngSize = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});
