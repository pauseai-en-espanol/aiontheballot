/**
 * What a source's copy may be (editorial workflow S2.2): documents with text, and images for sources without (a post's
 * screenshot). Never SVG or anything a browser would run: copies are only ever downloaded. Shared by uploads and by
 * the fetcher, which refuses any other type before sending a byte (ADR-0007).
 */
export const COPY_TYPES = [
  'application/pdf',
  'text/html',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type CopyType = (typeof COPY_TYPES)[number];

export const isCopyType = (type: string | undefined): type is CopyType =>
  (COPY_TYPES as readonly (string | undefined)[]).includes(type);
