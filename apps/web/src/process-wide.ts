/**
 * One instance per server process, whichever bundle asks: Next bundles the proxy, the pages and the route handlers
 * apart, so a module-level value would be one per bundle. The site's data caches must be one, so that a revalidation
 * (R151) refreshes what every page and image reads.
 */
export const processWide = <T>(name: string, create: () => T): T => {
  const key = Symbol.for(`aiontheballot.${name}`);
  const store = globalThis as typeof globalThis & Record<symbol, unknown>;
  if (!(key in store)) {
    store[key] = create();
  }
  return store[key] as T;
};
