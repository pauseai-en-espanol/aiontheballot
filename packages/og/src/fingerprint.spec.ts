import { describe, expect, it } from 'vitest';

import { fingerprintAll, fingerprintOf, renderProbes } from './fingerprint.js';
import { PROBES } from './probes.js';
import { SHARE_SIZES } from './sizes.js';
import { TEMPLATE_NAMES } from './templates.js';

describe('the fingerprint of a template (PLAN R147)', () => {
  it('is the same for the same pictures, and changes with any byte of any of them', () => {
    const renders = [
      { id: 'a.1200x630', png: new Uint8Array([1, 2, 3]) },
      { id: 'a.1080x1080', png: new Uint8Array([4, 5]) },
    ];
    const base = fingerprintOf(renders);
    expect(fingerprintOf(renders.map((r) => ({ ...r, png: r.png.slice() })))).toBe(base);
    expect(fingerprintOf([renders[0]!, { ...renders[1]!, png: new Uint8Array([4, 6]) }])).not.toBe(
      base,
    );
    expect(fingerprintOf([renders[1]!, renders[0]!])).not.toBe(base);
    // Where one picture ends and the next begins is part of it.
    expect(
      fingerprintOf([
        { id: 'a.1200x630', png: new Uint8Array([1, 2]) },
        { id: 'a.1080x1080', png: new Uint8Array([3, 4, 5]) },
      ]),
    ).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });

  it('comes from every probe of every template at every size, drawn the same way each time', async () => {
    for (const template of TEMPLATE_NAMES) {
      const first = await renderProbes(template);
      expect(first.map(({ id }) => id)).toEqual(
        PROBES[template].flatMap(({ id }) =>
          Object.keys(SHARE_SIZES).map((size) => `${id}.${size}`),
        ),
      );
      // Rendering is deterministic, or every build would move every URL for nothing.
      expect(fingerprintOf(await renderProbes(template))).toBe(fingerprintOf(first));
    }
    expect(Object.keys(await fingerprintAll())).toEqual([...TEMPLATE_NAMES]);
    // Every probe of every template, three times over.
  }, 60_000);
});
