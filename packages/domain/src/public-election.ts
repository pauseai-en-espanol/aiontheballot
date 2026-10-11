import type { Localized } from './localized.js';
import type { MethodologyKind, Rating } from './methodology.js';

/**
 * A public election, as the API serves it at GET /public/tenants/{slug}/elections/{election}: what the scorecard and
 * the party, criterion, cell and methodology pages show (public-site spec §5). Read as aiontheballot_web, so it holds
 * only what RLS makes public: a live or archived election of an active tenant, and its published revisions.
 */
export interface PublicElection {
  election: {
    slug: string;
    name: Localized;
    /** `YYYY-MM-DD`, a day, not an instant. */
    date: string | null;
    status: 'live' | 'archived';
  };
  methodology: PublicMethodology | null;
  /** In display order; parties that left the election are left out. */
  parties: PublicParty[];
  /** In display order; retired criteria are left out. */
  criteria: PublicCriterion[];
  /** Every published revision of every cell, newest first per cell. A cell with none is pending. */
  cells: PublicCell[];
}

export interface PublicMethodology {
  kind: MethodologyKind;
  /** Whose demands the ratings measure, for `demands`. */
  demandsOwner: { name: Localized; url: string | null } | null;
  /** Markdown, rendered and sanitized by the public site. */
  body: Localized;
  reviewers: { name: string; affiliation: string }[];
}

export interface PublicParty {
  id: string;
  slug: string;
  name: Localized;
  shortName: Localized;
  colour: string | null;
  website: string | null;
  programmeStatus: 'pending' | 'published';
  /** An ISO 8601 instant: when someone last checked; null if never. */
  programmeCheckedAt: string | null;
}

export interface PublicCriterion {
  id: string;
  slug: string;
  title: Localized;
  shortTitle: Localized | null;
  description: Localized;
}

export interface PublicCell {
  partyId: string;
  criterionId: string;
  /** Newest first. */
  revisions: PublicRevision[];
}

export interface PublicRevision {
  revisionNo: number;
  /** Null for a withdrawal. */
  rating: Rating | null;
  summary: Localized | null;
  changeKind: 'initial' | 'update' | 'correction' | 'withdrawal';
  publicNote: Localized | null;
  /** An ISO 8601 instant. */
  publishedAt: string;
  evidence: PublicEvidence[];
  checkedDocuments: { source: PublicSource; checkedAt: string }[];
}

export interface PublicEvidence {
  quote: string;
  locationLabel: string | null;
  source: PublicSource;
}

/** A source's public columns only (data model §5): never its stored copy, which stays private (PLAN P8). */
export interface PublicSource {
  title: string;
  /** The document's language, for its title and quotes; null if no one recorded it. */
  language: string | null;
  url: string | null;
  kind: string;
  sha256: string | null;
  retrievedAt: string | null;
  archiveUrl: string | null;
}

/** The API's answer when no public election has the slugs, told apart from a route the API doesn't have (yet). */
export const NO_PUBLIC_ELECTION = 'No public election';
