export type ImageCache = (key: string, render: () => Promise<Uint8Array>) => Promise<Uint8Array>;

/**
 * Rendered share images, by content-hash key: each is rendered once, concurrent requests share the render, and the
 * least recently used go first when it's full, by count or by the bytes kept. A failed render isn't kept, so the next
 * request tries again.
 */
export const createImageCache = ({
  maxEntries = 64,
  maxBytes = Number.POSITIVE_INFINITY,
}: { maxEntries?: number; maxBytes?: number } = {}): ImageCache => {
  const entries = new Map<string, { image: Promise<Uint8Array>; bytes: number }>();
  let total = 0;
  const drop = (key: string) => {
    const entry = entries.get(key);
    if (entry) {
      total -= entry.bytes;
      entries.delete(key);
    }
  };
  const trim = () => {
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries && total <= maxBytes) {
        break;
      }
      drop(oldest);
    }
  };
  return (key, render) => {
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key);
      entries.set(key, hit);
      return hit.image;
    }
    const rendering = render();
    const entry = { image: rendering, bytes: 0 };
    entries.set(key, entry);
    rendering.then(
      (image) => {
        if (entries.get(key) === entry) {
          entry.bytes = image.byteLength;
          total += entry.bytes;
          trim();
        }
      },
      () => {
        if (entries.get(key) === entry) {
          entries.delete(key);
        }
      },
    );
    trim();
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
  // Every view of every election has a card now (R148): a few thousand fit, at tens of KB each.
  store[GLOBAL_KEY] ??= createImageCache({ maxEntries: 4_000, maxBytes: 64 * 1024 * 1024 });
  return store[GLOBAL_KEY];
};
