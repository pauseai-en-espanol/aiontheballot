import type { BrandImage } from '@aiontheballot/domain/public-home';

import { createImageCache, type ImageCache } from './image-cache';

/** Brand images by content hash: immutable, so each is fetched once per process. */
const GLOBAL_KEY = Symbol.for('aiontheballot.brandImages');

const brandCache = (): ImageCache => {
  const store = globalThis as typeof globalThis & { [GLOBAL_KEY]?: ImageCache };
  store[GLOBAL_KEY] ??= createImageCache({ maxEntries: 32 });
  return store[GLOBAL_KEY];
};

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** `/brand/{sha256}.{ext}`, relative to the tenant's root (not the locale's: images are the same in every locale). */
export const brandImagePath = (image: BrandImage): string | undefined => {
  const extension = EXTENSIONS[image.contentType];
  return extension ? `/brand/${image.sha256}.${extension}` : undefined;
};

export const parseBrandImageFile = (
  file: string,
): { sha256: string; contentType: string } | undefined => {
  const [, sha256, extension] = /^([0-9a-f]{64})\.(png|jpg|webp)$/.exec(file) ?? [];
  const contentType = Object.keys(EXTENSIONS).find((type) => EXTENSIONS[type] === extension);
  return sha256 && contentType ? { sha256, contentType } : undefined;
};

/** A brand image's bytes from the API, which serves only what the tenant shows publicly. */
export const loadBrandImage = (slug: string, sha256: string): Promise<Uint8Array> =>
  brandCache()(`${slug}/${sha256}`, async () => {
    const apiUrl = process.env.API_URL;
    if (!apiUrl) {
      throw new Error('API_URL is not set');
    }
    const response = await fetch(
      new URL(`/public/tenants/${encodeURIComponent(slug)}/brand/${sha256}`, apiUrl),
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!response.ok) {
      throw new Error(`GET brand image of ${slug} answered ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  });
