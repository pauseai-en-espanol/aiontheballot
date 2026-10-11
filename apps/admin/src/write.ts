/**
 * The admin's writes, from the browser, straight to the API on its own origin (`/api/…`, which the gateway sends to
 * the API), as JSON: the API runs each in one `withActor` transaction, where the database decides (ADR-0002). What
 * comes back is a key the forms show in the page's language, never the database's own words.
 */

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
  'signedOut',
  'unexpected',
] as const;
export type WriteError = (typeof WRITE_ERRORS)[number];

export interface WriteAnswer {
  ok: boolean;
  error?: WriteError;
  /** The constraint that refused it, so a form can point at the field. */
  constraint?: string;
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
  if (isWriteError(key)) {
    return key;
  }
  return status === 400 ? 'invalid' : 'unexpected';
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
  let parsed: unknown;
  try {
    parsed = response.status === 204 ? undefined : await response.json();
  } catch {
    parsed = undefined;
  }
  if (response.ok) {
    return { ok: true, body: parsed };
  }
  const constraint =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { constraint?: unknown }).constraint
      : undefined;
  return {
    ok: false,
    error: writeError(response.status, parsed),
    ...(typeof constraint === 'string' ? { constraint } : {}),
  };
};
