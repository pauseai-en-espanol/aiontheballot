import type { ExtractedUnit, Extraction } from './extract.js';
import type { Extractor } from './server.js';

import { type ChildLimits, runInChild } from './child.js';

/** Whether a child's answer is an extraction: it runs on a party's document, so its answer is checked, not trusted. */
const isExtraction = (value: unknown): value is Extraction => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { status, units } = value as { status?: unknown; units?: unknown };
  if (status === 'not_applicable') {
    return true;
  }
  if (status !== 'done' || !Array.isArray(units) || units.length === 0) {
    return false;
  }
  const indexes = new Set<number>();
  return units.every((unit: unknown) => {
    const { index, label, body } = (unit ?? {}) as Partial<ExtractedUnit>;
    const fresh = typeof index === 'number' && !indexes.has(index);
    if (fresh) {
      indexes.add(index);
    }
    return (
      fresh &&
      Number.isInteger(index) &&
      index > 0 &&
      typeof label === 'string' &&
      typeof body === 'string'
    );
  });
};

/**
 * The worker's extractor (PLAN R133): each copy in a child process of its own (child.ts), running extract-child.js.
 * The document's faults (the parser failed, or ran out of time or memory, or answered with something that isn't an
 * extraction) are a failed extraction; the child not starting at all rejects, the worker's own fault.
 */
export const createChildExtractor =
  (script: URL, limits: ChildLimits): Extractor =>
  async (contentType, bytes) => {
    const outcome = await runInChild(script, [contentType], bytes, limits);
    if (outcome.kind === 'fault') {
      return { status: 'failed' };
    }
    const { ok, result } = (outcome.answer ?? {}) as { ok?: unknown; result?: unknown };
    return ok === true && isExtraction(result) ? result : { status: 'failed' };
  };
