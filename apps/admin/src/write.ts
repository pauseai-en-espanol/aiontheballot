/**
 * The admin's writes, from the browser, straight to the API on its own origin (`/api/…`, which the gateway sends to
 * the API), as JSON: the API runs each in one `withActor` transaction, where the database decides (ADR-0002). What
 * comes back is a key the forms show in the page's language, never the database's own words.
 */

import { confirmPath, here } from './auth/confirm';

/** What can go wrong, each a key under `errors` in packages/i18n. */
export const WRITE_ERRORS = [
  'forbidden',
  'stale',
  'incomplete',
  'taken',
  'linked',
  'invalid',
  'limit',
  'notFound',
  'lastCountryAdmin',
  'notMember',
  'draftExists',
  'needsDefaultLanguage',
  'noMethodology',
  'holdsRole',
  'mailFailed',
  'tooSoon',
  'notEnrolled',
  'cellChanged',
  'tooLarge',
  'fileType',
  'hasCopy',
  'otherType',
  'logoImage',
  'siteIcon',
  'restrictedAsset',
  'changeControlled',
  'fetchRefused',
  'fetchFailed',
  'fetchUnavailable',
  'noUrl',
  'noCopy',
  'hasArchive',
  'themeContrast',
  'signedOut',
  'tooManyTokens',
  'notForTokens',
  'stepUp',
  'unexpected',
] as const;
export type WriteError = (typeof WRITE_ERRORS)[number];

export interface WriteAnswer {
  ok: boolean;
  error?: WriteError;
  /** The constraint that refused it, so a form can point at the field. */
  constraint?: string;
  /** The request body's field whose value the API's schema refused (admin forms §1.2). */
  field?: string;
  body?: unknown;
}

const isWriteError = (value: unknown): value is WriteError =>
  typeof value === 'string' && (WRITE_ERRORS as readonly string[]).includes(value);

/** The answer's error: the API's key, else what its status means (a malformed request is a 400 of Fastify's own). */
export const writeError = (status: number, body: unknown): WriteError => {
  const key =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (status === 401) {
    return 'signedOut';
  }
  // Fastify's own refusals of an upload's size and type.
  if (status === 413) {
    return 'tooLarge';
  }
  if (status === 415) {
    return 'fileType';
  }
  if (isWriteError(key)) {
    return key;
  }
  return status === 400 ? 'invalid' : 'unexpected';
};

/** What the API answered, as a form shows it. */
export const answerOf = async (response: Response): Promise<WriteAnswer> => {
  let parsed: unknown;
  try {
    parsed = response.status === 204 ? undefined : await response.json();
  } catch {
    parsed = undefined;
  }
  if (response.ok) {
    return { ok: true, body: parsed };
  }
  if (
    response.status === 403 &&
    typeof window !== 'undefined' &&
    (parsed as { error?: unknown } | undefined)?.error === 'stepUp'
  ) {
    // One of the riskiest actions, with a second factor over 12 hours old (PLAN D23): every write's answer comes
    // through here, so this is where the page goes to confirm it's you, and comes back after.
    window.location.assign(confirmPath(here()));
  }
  const { constraint, field } =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { constraint?: unknown; field?: unknown })
      : {};
  return {
    ok: false,
    error: writeError(response.status, parsed),
    ...(typeof constraint === 'string' ? { constraint } : {}),
    ...(typeof field === 'string' ? { field } : {}),
  };
};

export const sendToApi = async (
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<WriteAnswer> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  return answerOf(response);
};

/**
 * A file, as its own bytes and type (a source's copy, S2.2), with its name in the query, and any other value the route
 * reads there (a cell's version, C14).
 */
export const uploadToApi = async (
  path: string,
  file: File,
  query: Record<string, string> = {},
): Promise<WriteAnswer> => {
  let response: Response;
  try {
    response = await fetch(
      `${path}?${new URLSearchParams({ ...query, filename: file.name.slice(0, 200) })}`,
      {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      },
    );
  } catch {
    return { ok: false, error: 'unexpected' };
  }
  return answerOf(response);
};
