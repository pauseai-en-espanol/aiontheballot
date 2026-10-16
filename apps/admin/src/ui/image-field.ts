/** What an image field holds: the image there is now, a new file to upload on save, or none any more. */
export type ImageChoice = { kind: 'keep' } | { kind: 'new'; file: File } | { kind: 'remove' };

/** What a logo or brand image may be (PLAN R142, R59), as the API takes it: never SVG, which can carry script. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4096;

export type ImageProblem = 'type' | 'size' | 'dimensions' | 'unreadable';

/** A file's size as people read it: in KB under a megabyte, else in MB, in the page's language. */
export const fileSize = (bytes: number, locale: string): string =>
  bytes < 1024 * 1024
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
