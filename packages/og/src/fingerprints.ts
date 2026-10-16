import type { TemplateName } from './templates.js';

/**
 * Each template's fingerprint, a digest of its probe cards rendered to PNG at every size: whatever changes a picture
 * (the template, satori, resvg, a font, a colour) changes it, and with it every image's URL (cardHash). The build
 * computes them (scripts/fingerprint.mjs, after tsc) and writes them over this file's compiled copy in dist, so
 * every server of one build agrees on them. Here, in source (and so in this package's own tests), there are none:
 * cardHash refuses a template without one, so a build that skipped the step fails loudly instead of serving changed
 * pictures under old URLs.
 */
export const FINGERPRINTS: Readonly<Partial<Record<TemplateName, string>>> = {};
