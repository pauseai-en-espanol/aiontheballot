import { afterAll, describe, expect, it } from 'vitest';

import type { Snapshot } from './archive.js';

import { type Fetched, FetchRefused } from './fetch-url.js';
import { buildFetcherApp } from './server.js';

const TOKEN = 'a-test-only-fetcher-token-of-more-than-32-characters';
const auth = { authorization: `Bearer ${TOKEN}` };

let next: () => Promise<Fetched> = async () => ({
  contentType: 'application/octet-stream',
  finalUrl: 'https://partido-ejemplo-a.example.org/programa.pdf',
  bytes: Buffer.from('%PDF-1.7 programa de ejemplo'),
});
let snapshot: () => Promise<Snapshot> = async () => ({
  archiveUrl:
    'https://archive.example.org/web/20261013120000/https://partido-ejemplo-a.example.org/',
});
const asked: string[] = [];
const app = buildFetcherApp({
  token: TOKEN,
  fetchUrl: async (url) => {
    asked.push(url);
    return next();
  },
  archive: async (url) => {
    asked.push(url);
    return snapshot();
  },
  maxFetches: 1,
});

afterAll(async () => {
  await app.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

describe("the fetcher's doors (ADR-0007 §1)", () => {
  it('refuses a request without the shared secret before looking at it', async () => {
    asked.length = 0;
    for (const headers of [
      {},
      { authorization: 'Bearer otra-cosa' },
      { authorization: TOKEN },
    ] as Record<string, string>[]) {
      expect((await post('/fetch', { url: 'https://example.org/' }, headers)).statusCode).toBe(401);
      expect((await post('/archive', { url: 'https://example.org/' }, headers)).statusCode).toBe(
        401,
      );
    }
    expect(asked).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });

  it("gives a URL's bytes with their type, sniffed when the site said only bytes", async () => {
    const answer = await post('/fetch', { url: 'https://partido-ejemplo-a.example.org/p' });
    expect(answer.statusCode).toBe(200);
    expect(answer.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-copy-type': 'application/pdf',
      'x-final-url': 'https://partido-ejemplo-a.example.org/programa.pdf',
    });
    expect(answer.rawPayload.toString()).toBe('%PDF-1.7 programa de ejemplo');
  });

  it('says why a URL gave no copy', async () => {
    for (const [refusal, status, body] of [
      [new FetchRefused('address'), 422, { error: 'address' }],
      [new FetchRefused('status', 404), 502, { error: 'status', status: 404 }],
      [new FetchRefused('timeout'), 504, { error: 'timeout' }],
      [new FetchRefused('tooLarge'), 413, { error: 'tooLarge' }],
    ] as const) {
      next = async () => {
        throw refusal;
      };
      const answer = await post('/fetch', { url: 'https://example.org/' });
      expect([answer.statusCode, answer.json()]).toEqual([status, body]);
    }
    expect((await post('/fetch', { url: '' })).statusCode).toBe(400);
    expect(
      (await post('/fetch', { url: `https://example.org/${'x'.repeat(2048)}` })).statusCode,
    ).toBe(400);
  });

  it('refuses a type no copy may have before sending a byte, and frees its place', async () => {
    next = async () => ({
      contentType: 'application/zip',
      finalUrl: 'https://example.org/a.zip',
      bytes: Buffer.from('PK'),
    });
    const refused = await post('/fetch', { url: 'https://example.org/a.zip' });
    expect([refused.statusCode, refused.json()]).toEqual([415, { error: 'fileType' }]);
    next = async () => ({
      contentType: 'text/plain',
      finalUrl: 'https://example.org/a.txt',
      bytes: Buffer.from('Hola'),
    });
    // One place (maxFetches 1): taken again at once.
    expect((await post('/fetch', { url: 'https://example.org/a.txt' })).statusCode).toBe(200);
  });

  it('fetches only so many at once', async () => {
    let release: () => void = () => undefined;
    next = () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            contentType: 'text/plain',
            finalUrl: 'https://example.org/',
            bytes: Buffer.from('x'),
          });
      });
    const first = post('/fetch', { url: 'https://example.org/' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await post('/fetch', { url: 'https://example.org/' })).statusCode).toBe(503);
    release();
    expect((await first).statusCode).toBe(200);
  });

  it("gives a snapshot's address, or none, and passes on only a web page's address", async () => {
    const answer = await post('/archive', { url: 'https://partido-ejemplo-a.example.org/' });
    expect(answer.json()).toEqual({
      archiveUrl:
        'https://archive.example.org/web/20261013120000/https://partido-ejemplo-a.example.org/',
    });
    snapshot = async () => ({ archiveUrl: null, reason: 'refused' });
    expect((await post('/archive', { url: 'https://example.org/' })).json()).toEqual({
      archiveUrl: null,
      reason: 'refused',
    });
    asked.length = 0;
    for (const url of ['file:///etc/passwd', 'https://u:p@example.org/', 'nada']) {
      expect((await post('/archive', { url })).statusCode, url).toBe(422);
    }
    expect(asked).toEqual([]);
  });
});
