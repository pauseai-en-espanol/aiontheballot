import { RESERVED_ELECTION_SLUGS } from '@aiontheballot/domain/routing';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The routes under a tenant's root, beside the pages: the folders of the internal tenant route. */
const TENANT_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  'app',
  '%5Ftenant',
  '[slug]',
  '[locale]',
);

describe("a tenant's routes", () => {
  it('take no first segment an election slug could: each is reserved, or has a dot no slug has', async () => {
    const folders = (await readdir(TENANT_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('['))
      .map((entry) => entry.name);
    expect(folders.length).toBeGreaterThan(0);
    for (const name of folders) {
      expect(
        name.includes('.') || (RESERVED_ELECTION_SLUGS as readonly string[]).includes(name),
        `${name} is a route an election slug could shadow: add it to RESERVED_ELECTION_SLUGS and the database`,
      ).toBe(true);
    }
  });
});
