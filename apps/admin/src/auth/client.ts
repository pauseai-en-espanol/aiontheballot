/**
 * The admin's calls to Better Auth's endpoints, from the browser, on its own origin (`/api/auth/*`, which the gateway
 * sends to the API): the cookies they set never pass through the admin's server, and the API sees the visitor's own
 * address. Plain strings only, so the forms ship no message formatter.
 */

/** What can go wrong, each a key under `auth.errors` in packages/i18n. */
export type AuthError =
  | 'invalidCredentials'
  | 'invalidPassword'
  | 'invalidCode'
  | 'rateLimited'
  | 'locked'
  | 'tooManyCodes'
  | 'expired'
  | 'unexpected';

export interface AuthAnswer {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/** Better Auth's error codes, by what the person can do about them. */
const ERRORS: Readonly<Record<string, AuthError>> = {
  INVALID_EMAIL_OR_PASSWORD: 'invalidCredentials',
  INVALID_EMAIL: 'invalidCredentials',
  INVALID_PASSWORD: 'invalidPassword',
  INVALID_CODE: 'invalidCode',
  INVALID_BACKUP_CODE: 'invalidCode',
  // Answered with 429 too, so the code decides before the status.
  ACCOUNT_TEMPORARILY_LOCKED: 'locked',
  // This sign-in used up its tries at a code.
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'tooManyCodes',
  // The sign-in awaiting a code, or the enrolling session, is gone.
  INVALID_TWO_FACTOR_COOKIE: 'expired',
};

/** The errors after which only signing in again helps. */
export const RESTART_ERRORS: ReadonlySet<AuthError> = new Set([
  'locked',
  'tooManyCodes',
  'expired',
]);

export const authError = ({ status, body }: AuthAnswer): AuthError => {
  const code = typeof body.code === 'string' ? body.code : '';
  return ERRORS[code] ?? (status === 429 ? 'rateLimited' : 'unexpected');
};

/** The ids an input is described by: its hint and, once there is one, the form's error. */
export const describedBy = (...ids: (string | false | undefined)[]): string | undefined =>
  ids.filter(Boolean).join(' ') || undefined;

export const postAuth = async (path: string, body: object): Promise<AuthAnswer> => {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, body: {} };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  return {
    ok: response.ok,
    status: response.status,
    body:
      typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
  };
};

/** A text field of a submitted form, as typed. */
export const formText = (form: HTMLFormElement, name: string): string => {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
};

/** An authenticator's code as typed or pasted, without the spaces and dashes people add or apps show. */
export const cleanCode = (value: string): string => value.replace(/[\s-]/g, '');

/**
 * A backup code as typed: Better Auth matches them exactly, as `xxxxx-xxxxx` with case kept, so only spaces go, and
 * the dash goes back in when someone left it out.
 */
export const cleanBackupCode = (value: string): string => {
  const code = value.replace(/\s/g, '');
  return /^[A-Z0-9]{10}$/i.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
};
