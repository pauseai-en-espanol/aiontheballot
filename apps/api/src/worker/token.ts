import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The secret the API and the worker share (ADR-0006), and the one it shares with the fetcher (ADR-0007), beside the
 * NetworkPolicies that already let only the API's pods reach them: a pod that gets past a policy still can't hand
 * either a request. Sealed in gitops, never logged.
 */
export const MIN_TOKEN_LENGTH = 32;

/** What a header can carry as it is: printable ASCII, no spaces (a sealed `openssl rand -hex 32` is 64 of them). */
const TOKEN = /^[\x21-\x7e]+$/u;

/**
 * A secret the API shares with a box it calls (WORKER_TOKEN, ADR-0006; FETCHER_TOKEN, ADR-0007), checked for length
 * and characters: a stray newline or a non-ASCII character would make every request fail to send, which would look
 * like a box that can't be reached. Errors name the variable, never echo it.
 */
export const readSharedToken = (name: string, value: string | undefined): string => {
  if (!value || value.length < MIN_TOKEN_LENGTH) {
    throw new Error(`${name} must have at least ${MIN_TOKEN_LENGTH} characters`);
  }
  if (!TOKEN.test(value)) {
    throw new Error(`${name} must be printable ASCII with no spaces`);
  }
  return value;
};

/** WORKER_TOKEN (ADR-0006), as readSharedToken checks it. */
export const readWorkerToken = (value: string | undefined): string =>
  readSharedToken('WORKER_TOKEN', value);

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Whether an `Authorization` header carries the token as a bearer credential, in constant time: both sides are hashed
 * first, so neither the compare nor the lengths say how much of a guess was right.
 */
export const bearerMatches = (header: unknown, token: string): boolean => {
  const scheme = 'Bearer ';
  if (typeof header !== 'string' || !header.startsWith(scheme)) {
    return false;
  }
  return timingSafeEqual(digest(header.slice(scheme.length)), digest(token));
};

/**
 * Whether a header carries the token as it is (the preview's, PLAN R181), in constant time, as bearerMatches compares:
 * a missing header, or several, never matches.
 */
export const headerMatches = (header: unknown, token: string): boolean =>
  typeof header === 'string' && timingSafeEqual(digest(header), digest(token));
