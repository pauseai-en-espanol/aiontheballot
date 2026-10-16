/**
 * The admin's API as a tool on a member's machine calls it (ADR-0008, PLAN R204): over HTTPS to the admin's address,
 * with the member's token and nothing else of theirs (no cookie). The API answers only the routes a token may reach.
 */

/** A token as the admin mints it: a prefix secret scanners can match, then 32 random bytes. */
const TOKEN = /^aiontheballot_[\w-]{43}$/;

/** Hosts a development copy of the admin may run on, the only ones reached over plain HTTP. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class AdminError extends Error {
  constructor(
    readonly status: number,
    /** The API's key for the refusal (`notForTokens`, `invalid`, `notFound`…), when it gave one. */
    readonly key: string | undefined,
    readonly field?: string,
  ) {
    super(key === undefined ? `The admin answered ${status}` : `The admin refused it: ${key}`);
  }
}

export interface AdminClient {
  get: (path: string) => Promise<unknown>;
  send: (method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<unknown>;
  /** Uploads bytes as the body, with their type (a logo). */
  upload: (path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) => Promise<unknown>;
}

/** The admin's address and the token, as the tool's environment gives them; refused if either can't be right. */
export const adminSettings = (
  env: Readonly<Record<string, string | undefined>>,
): { origin: string; token: string } => {
  const address = env['AIONTHEBALLOT_ADMIN_URL'];
  const token = env['AIONTHEBALLOT_TOKEN'];
  if (!address) {
    throw new Error(
      'Set AIONTHEBALLOT_ADMIN_URL to the admin’s address, such as https://admin.example.org',
    );
  }
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error('AIONTHEBALLOT_ADMIN_URL is not an address');
  }
  // The token goes in every request: never over plain HTTP, but to a copy on this machine.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new Error('AIONTHEBALLOT_ADMIN_URL must use https');
  }
  if (!token || !TOKEN.test(token)) {
    throw new Error('Set AIONTHEBALLOT_TOKEN to a token from the admin’s “Tokens for tools” page');
  }
  return { origin: url.origin, token };
};

const parsed = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === '') {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const createAdminClient = (
  { origin, token }: { origin: string; token: string },
  fetcher: typeof fetch = fetch,
): AdminClient => {
  const call = async (method: string, path: string, body?: RequestInit['body'], type?: string) => {
    const response = await fetcher(new URL(path, origin), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(type === undefined ? {} : { 'content-type': type }),
      },
      ...(body === undefined ? {} : { body }),
      // A redirect could take the token elsewhere: none is followed.
      redirect: 'error',
    });
    const answer = await parsed(response);
    if (!response.ok) {
      const { error, field } = (answer ?? {}) as { error?: unknown; field?: unknown };
      throw new AdminError(
        response.status,
        typeof error === 'string' ? error : undefined,
        typeof field === 'string' ? field : undefined,
      );
    }
    return answer;
  };
  return {
    get: (path) => call('GET', path),
    send: (method, path, body) =>
      call(method, path, body === undefined ? undefined : JSON.stringify(body), 'application/json'),
    upload: (path, bytes, contentType) => call('PUT', path, bytes, contentType),
  };
};
