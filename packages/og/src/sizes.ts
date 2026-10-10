/** The four share-image sizes (BRIEF §6, ADR-0003 §8), by their id in image URLs. */
export const SHARE_SIZES = {
  /** The link preview: og:image and twitter:image. */
  '1200x630': { width: 1200, height: 630 },
  /** Square feed posts. */
  '1080x1080': { width: 1080, height: 1080 },
  /** Portrait feed posts. */
  '1080x1350': { width: 1080, height: 1350 },
  /** Stories and status, whose apps cover the top and bottom with their own controls. */
  '1080x1920': { width: 1080, height: 1920 },
} as const;

export type ShareSize = keyof typeof SHARE_SIZES;

export const LINK_PREVIEW: ShareSize = '1200x630';

export const isShareSize = (value: unknown): value is ShareSize =>
  typeof value === 'string' && Object.hasOwn(SHARE_SIZES, value);
