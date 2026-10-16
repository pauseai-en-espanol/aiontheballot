import type { FastifyInstance } from 'fastify';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Snapshot } from './fetcher/archive.js';

import { createFetcherClient } from './fetcher-client.js';
import { type Fetched, FetchRefused } from './fetcher/fetch-url.js';
import { buildFetcherApp } from './fetcher/server.js';

const TOKEN = 'un-secreto-de-prueba-de-mas-de-32-caracteres';
const PAGE = 'https://partido-ejemplo-a.example.org/programa.pdf';

/** A real fetcher, on this machine, whose fetches and captures each test sets. */
let fetchUrl: (url: string) => Promise<Fetched> = async () => {
  throw new FetchRefused('unreachable');
};
let archive: (url: string) => Promise<Snapshot> = async () => ({
  archiveUrl: null,
  reason: 'refused',
});
let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  app = buildFetcherApp({
    token: TOKEN,
    fetchUrl: (value) => fetchUrl(value),
    archive: (value) => archive(value),
  });
  url = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterAll(async () => {
  await app.close();
});

const read = async (body: AsyncIterable<Uint8Array>) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
};

describe("the API's side of the fetcher (ADR-0007)", () => {
  it('gets a copy: its bytes, its type and where they came from', async () => {
    fetchUrl = async () => ({
      contentType: 'application/pdf',
      finalUrl: `${PAGE}?v=2`,
      bytes: Buffer.from('%PDF-1.7 programa de ejemplo'),
    });
    const fetched = await createFetcherClient({ url, token: TOKEN }).fetchCopy(PAGE);
    if ('problem' in fetched) {
      throw new Error(`No copy: ${fetched.problem}`);
    }
    expect([fetched.contentType, fetched.finalUrl]).toEqual(['application/pdf', `${PAGE}?v=2`]);
    expect(await read(fetched.body)).toBe('%PDF-1.7 programa de ejemplo');
  });

  it('says why there is no copy, as the member hears it', async () => {
    const client = createFetcherClient({ url, token: TOKEN });
    for (const [refusal, problem] of [
      [new FetchRefused('address'), 'refused'],
      [new FetchRefused('scheme'), 'refused'],
      [new FetchRefused('status', 404), 'failed'],
      [new FetchRefused('timeout'), 'failed'],
      [new FetchRefused('tooLarge'), 'tooLarge'],
    ] as const) {
      fetchUrl = async () => {
        throw refusal;
      };
      expect(await client.fetchCopy(PAGE), refusal.reason).toEqual({ problem });
    }
    fetchUrl = async () => ({
      contentType: 'application/zip',
      finalUrl: PAGE,
      bytes: Buffer.from('PK'),
    });
    expect(await client.fetchCopy(PAGE)).toEqual({ problem: 'fileType' });
    // A fetcher with another secret, or none at all, is unavailable: never the member's fault. A refused secret is
    // ours to hear.
    const errors: string[] = [];
    expect(
      await createFetcherClient({
        url,
        token: `${TOKEN}-otro`,
        onError: (error) => errors.push(error.message),
      }).fetchCopy(PAGE),
    ).toEqual({ problem: 'unavailable' });
    expect(errors).toEqual(['The fetcher refused a fetch: 401']);
    expect(await createFetcherClient({ url, token: `${TOKEN}-otro` }).fetchCopy(PAGE)).toEqual({
      problem: 'unavailable',
    });
    expect(
      await createFetcherClient({ url: 'http://127.0.0.1:9', token: TOKEN }).fetchCopy(PAGE),
    ).toEqual({ problem: 'unavailable' });
  });

  it("gets a snapshot's address, none, or that the fetcher couldn't be asked", async () => {
    const client = createFetcherClient({ url, token: TOKEN });
    archive = async () => ({ archiveUrl: 'https://archive.example.org/web/20261013120000/x' });
    expect(await client.archive(PAGE)).toEqual({
      archiveUrl: 'https://archive.example.org/web/20261013120000/x',
    });
    archive = async () => ({ archiveUrl: null, reason: 'timeout' });
    expect(await client.archive(PAGE)).toEqual({ archiveUrl: null });
    expect(
      await createFetcherClient({ url: 'http://127.0.0.1:9', token: TOKEN }).archive(PAGE),
    ).toBe('unavailable');
  });
});
