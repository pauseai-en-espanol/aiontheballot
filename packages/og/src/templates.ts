/**
 * The share-image templates, by the name their images' hashes carry (ADR-0003 §8). Each has fictional probe cards
 * (probes.ts) that the build renders to fingerprint it (fingerprint.ts), and that the reference test compares with
 * the committed pictures (reference/).
 */
export const TEMPLATE_NAMES = [
  'coming-soon',
  'overview',
  'party',
  'criterion',
  'cell',
  'methodology',
  'corrections',
  'table',
] as const;

export type TemplateName = (typeof TEMPLATE_NAMES)[number];
