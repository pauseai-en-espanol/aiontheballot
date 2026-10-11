import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface ApiAnswer {
  status: number;
  /** The parsed JSON body, or undefined when there was none. */
  body: unknown;
}

const TIMEOUT_MS = 5_000;

/**
 * A GET from the admin's server to the API (ADR-0003 §1: the admin reaches data only through the API), inside the
 * cluster at API_URL, with the browser's cookie and the admin host's name. The API answers /api only on the admin host
 * (its Host header, which fetch can't set, hence node:http). Nothing else of the browser's request is passed on.
 */
export const getFromApi = (path: string, { host, cookie }: { host: string; cookie?: string }) => {
  const base = process.env.API_URL;
  if (!base) {
    throw new Error('API_URL is not set');
  }
  const url = new URL(path, base);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<ApiAnswer>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'GET',
        headers: { host, accept: 'application/json', ...(cookie ? { cookie } : {}) },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          let body: unknown;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            body = undefined;
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('The API did not answer in time')));
    request.on('error', reject);
    request.end();
  });
};
