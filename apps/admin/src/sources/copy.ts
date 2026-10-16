/** What a source's copy may be (S2.2), as the API takes it, and how large. */
export const COPY_TYPES = [
  'application/pdf',
  'text/html',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export const MAX_COPY_BYTES = 50 * 1024 * 1024;
