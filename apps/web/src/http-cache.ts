/** A year, and never revalidated: a new picture always gets a new URL (ADR-0003 §8). */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Whether If-None-Match names this ETag: a list, weak or strong, or `*`. */
export const matchesEtag = (header: string | null, etag: string): boolean =>
  header !== null &&
  header.split(',').some((value) => {
    const tag = value.trim().replace(/^W\//, '');
    return tag === etag || tag === '*';
  });

export const plain = (status: number, body: string, cache = 'no-store'): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache },
  });
