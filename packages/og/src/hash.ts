import { createHash } from 'node:crypto';

import type { ShareSize } from './sizes.js';
import type { TemplateName } from './templates.js';

import { FINGERPRINTS } from './fingerprints.js';

/**
 * The content hash in an image's URL: the same template, size and data always give the same hash, and anything that
 * changes the picture changes it (ADR-0003 §8: content-hash URLs, cached as immutable). The data covers what the card
 * says; the template's fingerprint, computed at build time from probe renders, covers how it is drawn, so a template
 * change or a renderer upgrade that draws differently gives every image a new URL by itself.
 */
export const cardHash = (
  template: TemplateName,
  size: ShareSize,
  data: unknown,
  fingerprints: Readonly<Partial<Record<TemplateName, string>>> = FINGERPRINTS,
): string => {
  const fingerprint = fingerprints[template];
  if (!fingerprint) {
    throw new Error(
      `The ${template} card has no fingerprint: build @aiontheballot/og, whose build renders its probes`,
    );
  }
  return createHash('sha256')
    .update(JSON.stringify([fingerprint, template, size, data]))
    .digest('hex')
    .slice(0, 12);
};
