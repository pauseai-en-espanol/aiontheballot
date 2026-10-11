import { isIPv4, isIPv6 } from 'node:net';

/**
 * A fixed-window counter per key, in this process's memory: a backstop for public forms behind the database's own caps
 * (each replica counts on its own, so the limit holds per replica). Keys are visitors' addresses, never stored
 * anywhere else, and forgotten once their window is over.
 */
export const createRateLimiter = ({
  limit,
  windowMs,
  maxKeys = 10_000,
  now = Date.now,
}: {
  limit: number;
  windowMs: number;
  /** Past this many visitors at once, finished windows are dropped, then the oldest: memory stays bounded. */
  maxKeys?: number;
  now?: () => number;
}): ((key: string) => boolean) => {
  const windows = new Map<string, { count: number; endsAt: number }>();
  return (key) => {
    const time = now();
    let window = windows.get(key);
    if (!window || window.endsAt <= time) {
      if (windows.size >= maxKeys) {
        for (const [other, { endsAt }] of windows) {
          if (endsAt <= time) {
            windows.delete(other);
          }
        }
        // Still full: the windows opened longest ago go first (a Map keeps its insertion order).
        for (const other of windows.keys()) {
          if (windows.size < maxKeys) {
            break;
          }
          windows.delete(other);
        }
      }
      windows.delete(key);
      window = { count: 0, endsAt: time + windowMs };
      windows.set(key, window);
    }
    window.count += 1;
    return window.count <= limit;
  };
};

/**
 * The key a visitor's address is counted under: an IPv4 address as it is, an IPv6 one by its /64, the network one
 * household or server gets, so cycling through its addresses buys nothing. Anything else is one shared key.
 */
export const visitorKey = (address: string): string => {
  if (isIPv4(address)) {
    return address;
  }
  if (!isIPv6(address)) {
    return 'unknown';
  }
  const [head = '', tail = ''] = address.toLowerCase().split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/u, ''))
    .join(':')}::/64`;
};
