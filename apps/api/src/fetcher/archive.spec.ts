import { describe, expect, it } from 'vitest';

import { archiveSnapshot, isSnapshotUrl, readArchiveUrl } from './archive.js';

const ARCHIVE = 'https://archive.example.org';
const PAGE = 'https://partido-ejemplo-a.example.org/programa';

/** A fake archive answering each request in turn from `answers`, recording what it was asked. */
const archive = (answers: (() => Response)[]) => {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const send = (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: url instanceof Request ? url.url : url.toString(), init });
    const next = answers.shift();
    if (!next) {
      throw new Error('The fake archive has no more answers');
    }
    return next();
  }) as typeof fetch;
  return { asked, send };
};

const json =
  (value: unknown, status = 200) =>
  () =>
    Response.json(value, { status });

describe('archive snapshots (S4, ADR-0007 §4)', () => {
  it('asks for a capture, waits for it, and gives its address', async () => {
    const { asked, send } = archive([
      json({ url: PAGE, job_id: 'spn2-0123abcd' }),
      json({ status: 'pending', job_id: 'spn2-0123abcd' }),
      json({ status: 'success', timestamp: '20261013120000', original_url: PAGE }),
    ]);
    expect(
      await archiveSnapshot(PAGE, {
        archiveUrl: ARCHIVE,
        keys: { access: 'clave', secret: 'secreta' },
        pollMs: 1,
        fetch: send,
      }),
    ).toEqual({ archiveUrl: `${ARCHIVE}/web/20261013120000/${PAGE}` });
    expect(asked.map(({ url }) => url)).toEqual([
      `${ARCHIVE}/save`,
      `${ARCHIVE}/save/status/spn2-0123abcd`,
      `${ARCHIVE}/save/status/spn2-0123abcd`,
    ]);
    expect(asked[0]?.init?.method).toBe('POST');
    expect(asked[0]?.init?.body).toContain(`url=${encodeURIComponent(PAGE)}`);
    expect(asked[0]?.init?.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'LOW clave:secreta',
    });
  });

  it('sends no keys when it has none', async () => {
    const { asked, send } = archive([json({}, 429)]);
    expect(await archiveSnapshot(PAGE, { archiveUrl: ARCHIVE, fetch: send })).toEqual({
      archiveUrl: null,
      reason: 'refused',
    });
    expect(asked[0]?.init?.headers).not.toHaveProperty('authorization');
  });

  it('gives none for an error, a strange answer, an unreachable archive or a capture past the deadline', async () => {
    const opts = { archiveUrl: ARCHIVE, pollMs: 1 };
    expect(
      await archiveSnapshot(PAGE, {
        ...opts,
        fetch: archive([
          json({ job_id: 'spn2-x' }),
          json({ status: 'error', status_ext: 'error:x' }),
        ]).send,
      }),
    ).toEqual({ archiveUrl: null, reason: 'failed' });
    expect(
      await archiveSnapshot(PAGE, {
        ...opts,
        fetch: archive([
          json({ job_id: 'spn2-x' }),
          json({ status: 'success', timestamp: 'ayer', original_url: PAGE }),
        ]).send,
      }),
    ).toEqual({ archiveUrl: null, reason: 'failed' });
    expect(
      await archiveSnapshot(PAGE, {
        ...opts,
        fetch: archive([
          json({ job_id: 'spn2-x' }),
          json({ status: 'success', timestamp: '20261013120000', original_url: 'javascript:x' }),
        ]).send,
      }),
    ).toEqual({ archiveUrl: null, reason: 'failed' });
    expect(
      await archiveSnapshot(PAGE, { ...opts, fetch: archive([json({ job_id: '../../x' })]).send }),
    ).toEqual({ archiveUrl: null, reason: 'refused' });
    expect(await archiveSnapshot(PAGE, { ...opts, fetch: archive([]).send })).toEqual({
      archiveUrl: null,
      reason: 'unavailable',
    });
    const pending = () => Response.json({ status: 'pending' });
    expect(
      await archiveSnapshot(PAGE, {
        archiveUrl: ARCHIVE,
        pollMs: 5,
        deadlineMs: 40,
        fetch: archive([json({ job_id: 'spn2-x' }), ...Array.from({ length: 20 }, () => pending)])
          .send,
      }),
    ).toEqual({ archiveUrl: null, reason: 'timeout' });
  });

  it("takes only an https origin as the archive's address, and only snapshots under it", () => {
    expect(readArchiveUrl(undefined)).toBe('https://web.archive.org');
    expect(readArchiveUrl('https://archive.example.org/')).toBe(ARCHIVE);
    for (const wrong of [
      'http://archive.example.org',
      'https://archive.example.org/web',
      'https://u:p@archive.example.org',
    ]) {
      expect(() => readArchiveUrl(wrong), wrong).toThrow('ARCHIVE_URL');
    }
    expect(isSnapshotUrl(`${ARCHIVE}/web/20261013120000/${PAGE}`, ARCHIVE)).toBe(true);
    expect(isSnapshotUrl(`${ARCHIVE}/web/2026/${PAGE}`, ARCHIVE)).toBe(false);
    expect(isSnapshotUrl(`${ARCHIVE}/web/20261013120000/ftp://x`, ARCHIVE)).toBe(false);
    expect(isSnapshotUrl(`https://otro.example.org/web/20261013120000/${PAGE}`, ARCHIVE)).toBe(
      false,
    );
    expect(isSnapshotUrl(`${ARCHIVE}.otro.example/web/20261013120000/${PAGE}`, ARCHIVE)).toBe(
      false,
    );
  });
});
