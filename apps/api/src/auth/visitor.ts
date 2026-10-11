import { isIP } from 'node:net';

/**
 * The address a sign-in attempt is counted against: the last `X-Forwarded-For` entry, the one the gateway adds after
 * dropping any the client sent (as the analytics relay reads it, PLAN R83), never an earlier one, which a client can
 * write. Without a valid one (a request from inside the cluster, or the tests), the connection's own address: unlike
 * an analytics event, an attempt with no address must not escape the limit, so it shares its sender's bucket.
 */
export const visitorAddress = (
  forwardedFor: string | string[] | undefined,
  socketAddress: string | undefined,
): string | undefined => {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  const last = header
    ?.split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .at(-1);
  if (last !== undefined && isIP(last) !== 0) {
    return last;
  }
  return socketAddress !== undefined && isIP(socketAddress) !== 0 ? socketAddress : undefined;
};
