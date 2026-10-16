import { createHash } from 'node:crypto';

import { PROBES } from './probes.js';
import { renderPng } from './render.js';
import { SHARE_SIZES, type ShareSize } from './sizes.js';
import { TEMPLATE_NAMES, type TemplateName } from './templates.js';

/** One probe card rendered at one size: `{probe}.{size}`, as its reference picture is named. */
export interface ProbeRender {
  id: string;
  png: Uint8Array;
}

const SIZES = Object.keys(SHARE_SIZES) as ShareSize[];

/** Every probe of the template at every size, as the build and the reference test render them. */
export const renderProbes = async (template: TemplateName): Promise<ProbeRender[]> => {
  const renders: ProbeRender[] = [];
  for (const probe of PROBES[template]) {
    for (const size of SIZES) {
      renders.push({ id: `${probe.id}.${size}`, png: await renderPng(probe.node(size), size) });
    }
  }
  return renders;
};

/** The digest of the renders' pixels as PNG: equal renders give equal fingerprints; any changed byte, another. */
export const fingerprintOf = (renders: readonly ProbeRender[]): string => {
  const digest = createHash('sha256');
  for (const { id, png } of renders) {
    digest.update(`${id}\0${png.byteLength}\0`).update(png);
  }
  return digest.digest('hex').slice(0, 16);
};

/** Every template's fingerprint: what the build writes into dist/fingerprints.js. */
export const fingerprintAll = async (): Promise<Record<TemplateName, string>> => {
  const entries: [TemplateName, string][] = [];
  for (const template of TEMPLATE_NAMES) {
    entries.push([template, fingerprintOf(await renderProbes(template))]);
  }
  return Object.fromEntries(entries) as Record<TemplateName, string>;
};
