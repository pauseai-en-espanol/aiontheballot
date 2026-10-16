import { PREVIEW_TOKEN_HEADER } from './routing-proxy';

/**
 * Which of the API's data a loader reads (PLAN R181): the public's, under `/public`, or the admin's preview's, under
 * `/preview`, which the API serves only with the secret the admin and this app share (ADR-0005) and reads as the
 * preview's own role, so it holds elections in preview too. Never the same cache: a preview loader is its own.
 */
export interface PreviewAccess {
  token: string;
}

/** The API path of a site's data, under the stage's prefix. */
export const stagePath = (preview: PreviewAccess | undefined, path: string): string =>
  `${preview ? '/preview' : '/public'}${path}`;

/** The request's headers for the stage: the secret, for the preview's; none for the public's. */
export const stageHeaders = (preview: PreviewAccess | undefined): Record<string, string> =>
  preview ? { [PREVIEW_TOKEN_HEADER]: preview.token } : {};

/**
 * A GET of the API, 5 seconds a try, tried once more when the connection closed before any answer (PLAN R188): in a
 * rollout, an API pod shutting down closes the kept-alive connection a request may just have gone out on, and the
 * next one reaches a pod that runs. Never after an answer, whatever its status, nor after the time ran out (the API is
 * slow, not gone): Node's fetch throws a TypeError only when no answer came.
 */
export const fetchApi = async (
  fetchImpl: typeof fetch,
  url: URL,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const get = () => fetchImpl(url, { headers, signal: AbortSignal.timeout(5_000) });
  try {
    return await get();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return get();
  }
};

/**
 * Fetches a site's data from the API for the stage, the API reading the secret from the header this app reads the
 * admin's from. The preview's falls back to the public's while the API has no preview configured (503: its role or
 * secret not set yet): the public data is a part of the preview's, so the preview then shows what the public sees,
 * rather than nothing. (An API older than the preview's routes answers 404 instead, for the minutes of a rollout.)
 */
export const fetchStaged = async (
  fetchImpl: typeof fetch,
  apiUrl: string,
  preview: PreviewAccess | undefined,
  path: string,
): Promise<Response> => {
  const response = await fetchApi(
    fetchImpl,
    new URL(stagePath(preview, path), apiUrl),
    stageHeaders(preview),
  );
  if (!preview || response.status !== 503) {
    return response;
  }
  await response.body?.cancel();
  console.error(`The API has no preview configured: ${path} shows the public data`);
  return fetchApi(fetchImpl, new URL(stagePath(undefined, path), apiUrl), stageHeaders(undefined));
};
