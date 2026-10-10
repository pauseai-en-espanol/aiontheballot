export type ImageCache = (key: string, render: () => Promise<Uint8Array>) => Promise<Uint8Array>;

/**
 * Rendered share images, by content-hash key: each is rendered once, concurrent requests share the render, and the
 * least recently used go first when it's full. A failed render isn't kept, so the next request tries again.
 */
export const createImageCache = ({ maxEntries = 64 }: { maxEntries?: number } = {}): ImageCache => {
  const entries = new Map<string, Promise<Uint8Array>>();
  return (key, render) => {
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit;
    }
    const rendering = render();
    entries.set(key, rendering);
    rendering.catch(() => {
      if (entries.get(key) === rendering) {
        entries.delete(key);
      }
    });
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) {
        break;
      }
      entries.delete(oldest);
    }
    return rendering;
  };
};

const GLOBAL_KEY = Symbol.for('aiontheballot.shareImages');

/**
 * One cache per server process. Next bundles the page and the image route separately, so a module-level cache would
 * be two: the page warms the image the route then serves.
 */
export const shareImages = (): ImageCache => {
  const store = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ImageCache };
  store[GLOBAL_KEY] ??= createImageCache();
  return store[GLOBAL_KEY];
};
