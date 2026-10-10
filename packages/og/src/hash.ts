import { palette } from '@aiontheballot/ui/brand';
import { createHash } from 'node:crypto';

import type { ShareSize } from './sizes.js';

import { ROBOTO_SLAB_400, SAIRA_CONDENSED_700 } from './fonts.generated.js';

/**
 * Bump when a template's look changes (layout, or a renderer upgrade that draws differently): every image then gets
 * a new URL, so crawlers and apps that cache by URL fetch it again. A test pins the SVG each version draws.
 */
export const TEMPLATE_VERSION = 1;

/** What the pictures depend on besides their template and data, folded into every hash: the colours and the fonts. */
const RENDER_INPUTS = createHash('sha256')
  .update(JSON.stringify(palette))
  .update(SAIRA_CONDENSED_700)
  .update(ROBOTO_SLAB_400)
  .digest('hex');

/**
 * The content hash in an image's URL: the same template, size and data always give the same hash, and anything
 * that changes the picture changes it (ADR-0003 §8: content-hash URLs, cached as immutable).
 */
export const cardHash = (template: string, size: ShareSize, data: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify([TEMPLATE_VERSION, RENDER_INPUTS, template, size, data]))
    .digest('hex')
    .slice(0, 12);
