import { getIsolationScope } from '@sentry/node';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initErrorTracking } from '../error-tracking.js';
import { FETCHER_TRACKING } from './error-tracking.js';
import { fetchUrl } from './fetch-url.js';

const seen: IncomingHttpHeaders[] = [];
const server = createServer((request, response) => {
  seen.push(request.headers);
  response.writeHead(200, { 'content-type': 'text/plain' }).end('Hola');
});
let port = '';

beforeAll(async () => {
  // On, as in production, with a DSN that leads nowhere: what leaves with a fetch is what this test looks at.
  initErrorTracking(
    { value: 'http://abcdef0123456789abcdef0123456789@127.0.0.1:9/1' } as never,
    FETCHER_TRACKING,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? String(address.port) : '';
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("the fetcher's error tracking (ADR-0007 §6)", () => {
  it('sends a site no trace header, and keeps no breadcrumb of what it fetched', async () => {
    await fetchUrl(`http://127.0.0.1:${port}/programa/secreto-en-la-ruta`, {
      maxBytes: 1_000,
      deadlineMs: 2_000,
      userAgent: 'test-fetcher',
      isAllowedAddress: (address) => address === '127.0.0.1',
      ports: new Set([port]),
    });
    await fetch(`http://127.0.0.1:${port}/archivo`);
    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(
        Object.keys(headers).filter((name) => /sentry|baggage|traceparent/u.test(name)),
      ).toEqual([]);
    }
    expect(JSON.stringify(getIsolationScope().getScopeData().breadcrumbs)).not.toContain(
      'secreto-en-la-ruta',
    );
  });
});
