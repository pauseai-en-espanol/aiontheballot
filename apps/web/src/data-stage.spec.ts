import { describe, expect, it, vi } from 'vitest';

import { fetchApi, fetchStaged } from './data-stage';

const API = 'http://api.test';

/** What Node's fetch throws when the connection closes before any answer: a TypeError, its cause the socket's. */
const dropped = () =>
  Object.assign(new TypeError('fetch failed'), { cause: new Error('other side closed') });

describe("reading the API's data (PLAN R188)", () => {
  it('tries once more when the connection closed before any answer, as an API pod shutting down does', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(dropped())
      .mockResolvedValueOnce(new Response('{}'));
    const response = await fetchStaged(fetchImpl, API, undefined, '/tenants/demo');
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toEqual(new URL('/public/tenants/demo', API));
  });

  it('tries only once more, and never after an answer, an error status included', async () => {
    const twice = vi.fn<typeof fetch>().mockRejectedValue(dropped());
    await expect(fetchApi(twice, new URL('/public/routing', API))).rejects.toThrow('fetch failed');
    expect(twice).toHaveBeenCalledTimes(2);

    const answered = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    expect((await fetchApi(answered, new URL('/public/routing', API))).status).toBe(500);
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('never tries again after its time ran out: the API is slow, not gone', async () => {
    const timedOut = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(fetchApi(timedOut, new URL('/public/routing', API))).rejects.toThrow('timed out');
    expect(timedOut).toHaveBeenCalledTimes(1);
  });

  it('sends the same headers the second time, with a time limit of its own', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(dropped())
      .mockResolvedValueOnce(new Response('{}'));
    await fetchStaged(fetchImpl, API, { token: 'secreto' }, '/tenants/demo');
    const [first, second] = fetchImpl.mock.calls.map((call) => call[1]);
    expect(second?.headers).toEqual(first?.headers);
    expect(second?.signal).toBeInstanceOf(AbortSignal);
    expect(second?.signal).not.toBe(first?.signal);
  });
});
