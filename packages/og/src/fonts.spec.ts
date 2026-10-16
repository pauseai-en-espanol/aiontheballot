import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { ROBOTO_SLAB_400, SAIRA_CONDENSED_700 } from './fonts.generated.js';

describe('the embedded fonts', () => {
  it.each([
    ['saira-condensed-latin-700-normal.woff', SAIRA_CONDENSED_700],
    ['roboto-slab-latin-400-normal.woff', ROBOTO_SLAB_400],
  ])('match fonts/%s (run `pnpm fonts` after replacing one)', async (file, embedded) => {
    const original = await readFile(new URL(`../fonts/${file}`, import.meta.url));
    expect(Buffer.from(embedded, 'base64').equals(original)).toBe(true);
  });
});
