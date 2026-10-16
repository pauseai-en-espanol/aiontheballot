import { cache } from 'react';

import type { SourceKind } from '@/elections/data';

import { readApi, tenantPath } from '@/data';

/**
 * The admin's reads of an election's sources (editorial workflow §7), from server components. The API reads them under
 * RLS; these shapes only say what the pages expect.
 */

export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'not_applicable';

export interface Source {
  id: string;
  title: string;
  kind: SourceKind;
  url: string | null;
  language: string | null;
  partyId: string | null;
  isProgramme: boolean;
  /** The stored copy, once there is one. */
  copy: { sha256: string; byteSize: number; contentType: string; retrievedAt: string } | null;
  extractionStatus: ExtractionStatus;
  archiveUrl: string | null;
  units: number;
  /** Quotes and checked documents citing it: it can be deleted only at 0 (S5.2). */
  citations: number;
  extractionRequested: boolean;
  /** Whether a snapshot of its URL has been asked for and is still awaited (S4). */
  archiveRequested?: boolean;
  /** A stored copy, and its text extracted or none to extract (S3.4). */
  citable: boolean;
  /** When it was marked replaced (PLAN D14): it takes no new quote or check, and is listed last. */
  replacedAt?: string | null;
}

/** What the user may do with the election's sources, and what this deployment offers. */
export interface SourceCapabilities {
  canEdit: boolean;
  /** Whether copies can be stored (the file store is configured). */
  uploads: boolean;
  /** Whether the worker extracts their text. */
  extraction: boolean;
  /** Whether a copy can be fetched from a source's URL (ADR-0007). */
  fetching?: boolean;
  /** Whether snapshots of sources' URLs are taken (S4). */
  archiving?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const shaped = <T>(value: unknown, keys: readonly string[], what: string): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value) || !keys.every((key) => key in value)) {
    throw new Error(`The API's answer for ${what} isn't what the admin expects`);
  }
  return value as T;
};

export const sourcesPath = (tenant: string, election: string) =>
  `${tenantPath(tenant)}/e/${encodeURIComponent(election)}/sources`;

/** The election's sources, programmes first (S3.4: each with its state). */
export const getSources = cache(async (tenant: string, election: string) =>
  shaped<{ sources: Source[] } & SourceCapabilities>(
    await readApi(sourcesPath(tenant, election)),
    ['sources', 'canEdit'],
    'the sources',
  ),
);

/** One source with its extracted text, by page or section (S6). */
export const getSource = cache(async (tenant: string, election: string, id: string) =>
  shaped<
    { source: Source; units: { index: number; label: string; body: string }[] } & SourceCapabilities
  >(
    await readApi(`${sourcesPath(tenant, election)}/${encodeURIComponent(id)}`),
    ['source', 'units', 'canEdit'],
    'a source',
  ),
);
