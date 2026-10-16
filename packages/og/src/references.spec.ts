import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { renderProbes } from './fingerprint.js';
import { TEMPLATE_NAMES } from './templates.js';

/**
 * Every template's probe cards, drawn now, against the committed reference pictures (PLAN R147). The URLs follow the
 * pictures by themselves (fingerprint.ts); this test makes a changed picture a reviewed one: a template change, or a
 * satori, resvg or font upgrade that draws differently, fails here until accepted with `pnpm cards:accept`. Old, new
 * and a diff of each changed picture are written to test-output/, which CI keeps as an artifact.
 *
 * A small tolerance, for rasterisers on other machines: colour differences under pixelmatch's threshold, and
 * anti-aliased edges, don't count; past that, at most one pixel in a thousand may differ.
 */
const THRESHOLD = 0.1;
const MAX_DIFFERING = 0.001;

const REFERENCE = new URL('../reference/', import.meta.url);
const OUTPUT = new URL('../test-output/', import.meta.url);
const ACCEPT = 'If the change is intended, run `pnpm cards:accept` and commit the new pictures';

beforeAll(async () => {
  await rm(OUTPUT, { recursive: true, force: true });
});

/** Writes old, new and diff for a reviewer: what CI uploads. */
const keep = async (template: string, id: string, pictures: Record<string, Uint8Array>) => {
  const folder = new URL(`${template}/`, OUTPUT);
  await mkdir(folder, { recursive: true });
  for (const [kind, png] of Object.entries(pictures)) {
    await writeFile(new URL(`${id}.${kind}.png`, folder), png);
  }
};

describe.each(TEMPLATE_NAMES)('the %s card', (template) => {
  it('draws what its reference pictures show', async () => {
    const failures: string[] = [];
    for (const { id, png } of await renderProbes(template)) {
      const file = new URL(`${template}/${id}.png`, REFERENCE);
      const before = await readFile(file).catch(() => undefined);
      if (!before) {
        await keep(template, id, { new: png });
        failures.push(`${id}: no reference picture`);
        continue;
      }
      const old = PNG.sync.read(before);
      const now = PNG.sync.read(Buffer.from(png));
      if (old.width !== now.width || old.height !== now.height) {
        await keep(template, id, { old: before, new: png });
        failures.push(`${id}: ${old.width}×${old.height} became ${now.width}×${now.height}`);
        continue;
      }
      const diff = new PNG({ width: now.width, height: now.height });
      const differing = pixelmatch(old.data, now.data, diff.data, now.width, now.height, {
        threshold: THRESHOLD,
        includeAA: false,
      });
      if (differing > now.width * now.height * MAX_DIFFERING) {
        await keep(template, id, { old: before, new: png, diff: PNG.sync.write(diff) });
        failures.push(`${id}: ${differing} pixels differ`);
      }
    }
    expect(
      failures,
      `The ${template} card draws differently (old, new and diff in packages/og/test-output/${template}). ${ACCEPT}.`,
    ).toEqual([]);
    // Every probe at every size, rendered and compared: seconds on a slow runner.
  }, 30_000);
});
