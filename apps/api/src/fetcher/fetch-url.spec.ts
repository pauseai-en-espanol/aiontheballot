import { createServer, type RequestListener, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { copyType, type FetchOptions, FetchRefused, fetchUrl } from './fetch-url.js';

/** A fictional party site on this machine, whose routes each test sets. */
const routes = new Map<string, RequestListener>();
let server: Server;
let port: string;
const seen: Record<string, string | string[] | undefined>[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push(request.headers);
    const route = routes.get(request.url ?? '');
    if (route) {
      route(request, response);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? String(address.port) : '';
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const site = (path: string) => `http://127.0.0.1:${port}${path}`;

/** As the fetcher runs, but allowed this machine's test site (its address and port) and nothing else. */
const options = (more: Partial<FetchOptions> = {}): FetchOptions => ({
  maxBytes: 1024,
  deadlineMs: 2_000,
  userAgent: 'test-fetcher',
  isAllowedAddress: (address) => address === '127.0.0.1',
  ports: new Set([port]),
  ...more,
});

const refusal = async (promise: Promise<unknown>) => {
  const error: unknown = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(FetchRefused);
  return error as FetchRefused;
};

describe('fetching a URL (ADR-0007 §2)', () => {
  it('gives the bytes, the declared type and the final address, sending nothing of the member', async () => {
    routes.set('/programa.pdf', (_request, response) => {
      response.writeHead(200, { 'content-type': 'Application/PDF; charset=binary' });
      response.end('%PDF-1.7 programa de ejemplo');
    });
    seen.length = 0;
    const fetched = await fetchUrl(site('/programa.pdf'), options());
    expect(fetched).toEqual({
      contentType: 'application/pdf',
      finalUrl: site('/programa.pdf'),
      bytes: Buffer.from('%PDF-1.7 programa de ejemplo'),
    });
    expect(seen[0]?.['user-agent']).toBe('test-fetcher');
    expect(seen[0]).not.toHaveProperty('cookie');
    expect(seen[0]).not.toHaveProperty('referer');
  });

  it('follows a few redirects, each checked like the first URL', async () => {
    routes.set('/antes', (_request, response) => {
      response.writeHead(301, { location: '/despues' }).end();
    });
    routes.set('/despues', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Hola</p>');
    });
    expect((await fetchUrl(site('/antes'), options())).finalUrl).toBe(site('/despues'));

    // To an address it may not reach, written in the URL or behind a name.
    routes.set('/a-dentro', (_request, response) => {
      response.writeHead(302, { location: `http://10.0.0.1:${port}/` }).end();
    });
    expect((await refusal(fetchUrl(site('/a-dentro'), options()))).reason).toBe('address');
    routes.set('/a-nombre', (_request, response) => {
      response.writeHead(302, { location: `http://localhost:${port}/` }).end();
    });
    // The first address, written in the URL, is allowed; what the name resolves to, checked in the lookup, isn't.
    const asked: string[] = [];
    const firstOnly = (address: string) => asked.push(address) === 1 && address === '127.0.0.1';
    expect(
      (await refusal(fetchUrl(site('/a-nombre'), options({ isAllowedAddress: firstOnly })))).reason,
    ).toBe('address');
    expect(asked.length).toBeGreaterThan(1);
    // To another scheme, and in circles.
    routes.set('/a-fichero', (_request, response) => {
      response.writeHead(302, { location: 'file:///etc/passwd' }).end();
    });
    expect((await refusal(fetchUrl(site('/a-fichero'), options()))).reason).toBe('scheme');
    routes.set('/vuelta', (_request, response) => {
      response.writeHead(307, { location: '/vuelta' }).end();
    });
    expect((await refusal(fetchUrl(site('/vuelta'), options()))).reason).toBe('redirects');
  });

  it('refuses before connecting what is not on the public internet over http or https', async () => {
    const strict = { ...options(), isAllowedAddress: undefined, ports: undefined };
    for (const url of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.96.0.1/',
      'http://localhost/',
    ]) {
      expect((await refusal(fetchUrl(url, strict))).reason, url).toBe('address');
    }
    for (const url of [
      'ftp://example.org/',
      'file:///etc/passwd',
      'http://usuario:clave@example.org/',
      'http://example.org:8080/',
      'javascript:alert(1)',
      'no es una dirección',
    ]) {
      expect((await refusal(fetchUrl(url, strict))).reason, url).toBe('scheme');
    }
  });

  it("refuses a site's error, too much, and too slow", async () => {
    routes.set('/no-esta', (_request, response) => {
      response.writeHead(410).end();
    });
    const gone = await refusal(fetchUrl(site('/no-esta'), options()));
    expect([gone.reason, gone.status]).toEqual(['status', 410]);

    routes.set('/grande', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '2048' });
      response.end('x'.repeat(2048));
    });
    expect((await refusal(fetchUrl(site('/grande'), options()))).reason).toBe('tooLarge');
    routes.set('/grande-sin-decirlo', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x'.repeat(800));
      response.end('x'.repeat(800));
    });
    expect((await refusal(fetchUrl(site('/grande-sin-decirlo'), options()))).reason).toBe(
      'tooLarge',
    );
    // Compressed small, too large once decoded: counted as decoded.
    routes.set('/bomba', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      response.end(gzipSync(Buffer.alloc(100_000)));
    });
    expect((await refusal(fetchUrl(site('/bomba'), options()))).reason).toBe('tooLarge');

    routes.set('/lenta', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('empieza');
      setTimeout(() => response.end('y acaba'), 500).unref();
    });
    expect((await refusal(fetchUrl(site('/lenta'), options({ deadlineMs: 200 })))).reason).toBe(
      'timeout',
    );
  });

  it('gives up on a compressed body that stalls or is cut off, never waiting for ever', async () => {
    const compressed = gzipSync(Buffer.from('x'.repeat(600)));
    routes.set('/comprimida-lenta', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      response.write(compressed.subarray(0, 10));
      setTimeout(() => response.end(compressed.subarray(10)), 2_000).unref();
    });
    const started = Date.now();
    expect(
      (await refusal(fetchUrl(site('/comprimida-lenta'), options({ deadlineMs: 200 })))).reason,
    ).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1_500);

    routes.set('/comprimida-cortada', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      response.write(compressed.subarray(0, 10), () => {
        setTimeout(() => response.socket?.destroy(), 20).unref();
      });
    });
    expect(
      (await refusal(fetchUrl(site('/comprimida-cortada'), options({ deadlineMs: 1_500 })))).reason,
    ).toBe('unreachable');
  });

  it('decodes a compressed page', async () => {
    routes.set('/comprimida', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(gzipSync('<p>Página de ejemplo</p>'));
    });
    expect((await fetchUrl(site('/comprimida'), options())).bytes.toString()).toBe(
      '<p>Página de ejemplo</p>',
    );
  });
});

describe('the type a fetched copy is stored as', () => {
  it('is the declared one, or what the first bytes show when the site declared only bytes', () => {
    const pdf = Buffer.from('%PDF-1.4');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const webp = Buffer.from('RIFF\0\0\0\0WEBPVP8 ');
    expect(copyType('text/html', pdf)).toBe('text/html');
    expect(copyType('application/xhtml+xml', pdf)).toBe('text/html');
    expect(copyType('application/octet-stream', pdf)).toBe('application/pdf');
    expect(copyType(undefined, png)).toBe('image/png');
    expect(copyType('binary/octet-stream', webp)).toBe('image/webp');
    expect(copyType('application/octet-stream', Buffer.from('MZ'))).toBeUndefined();
    expect(copyType('application/zip', pdf)).toBe('application/zip');
  });
});
