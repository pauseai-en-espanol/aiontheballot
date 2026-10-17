import type { Actor } from '@aiontheballot/db/actor';
import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';
import type { IncomingMessage } from 'node:http';

import { withActor } from '@aiontheballot/db/actor';
import { EmptyError, type FileStore, TooLargeError } from '@aiontheballot/db/file-store';
import { imageSize } from '@aiontheballot/domain/image-size';
import { type Rating, RATINGS } from '@aiontheballot/domain/methodology';
import { BRAND_SLOTS } from '@aiontheballot/domain/public-home';
import {
  matchPrepared,
  type PreparedSource,
  prepareSource,
} from '@aiontheballot/domain/quote-match';
import {
  THEME_COLOURS,
  type ThemeColour,
  themeColourProblem,
} from '@aiontheballot/domain/site-theme';
import { isLocale, LOCALES } from '@aiontheballot/i18n/messages';
import { captureException } from '@sentry/node';
import * as z from 'zod';

import type { InvitedAccounts } from '../auth/invited-accounts.js';
import type { PasswordLinks } from '../auth/password-links.js';
import type { FetcherClient } from '../fetcher-client.js';
import type { ProfileSource } from './profiles.js';

import { PasswordMailFailed } from '../auth/password-links.js';
import { COPY_TYPES, isCopyType } from '../copy-types.js';
import { databaseRefusal } from '../database-errors.js';
import { mailFailure } from '../mail/mailer.js';
import { createRateLimiter } from '../rate-limit.js';
import { limitUnreadBodies } from '../unread-body.js';
import {
  type Access,
  accessTo,
  holds,
  isPlatformAdmin,
  lockTenant,
  TENANT_ROLES,
} from './access.js';
import { auditFilter, listAudit } from './audit.js';
import { BRAND_SLOT_NAMES, listBrand, setBrandImage } from './brand.js';
import { cellGrid } from './cell-grid.js';
import {
  addCheckedDocument,
  addQuote,
  attachAttestationFile,
  attestationFile,
  attestationUploadCheck,
  attestQuote,
  type CellChange,
  type ChangeKind,
  clearRecheck,
  commentOnCell,
  createCell,
  deleteCell,
  getCell,
  moveCell,
  publishCell,
  rejectCell,
  removeCheckedDocument,
  removeQuote,
  saveCell,
  setQuoteClip,
  sourceUnits,
  sourceVisible,
  withdrawAttestation,
} from './cells.js';
import {
  CHANGE_ACTIONS,
  CHANGE_TARGETS,
  CHANGEABLE,
  type ChangeAction,
  type ChangeTarget,
  decideChange,
  listChanges,
  nextDisplayOrder,
  type Proposal,
  proposeChange,
  withdrawChange,
} from './changes.js';
import { goLiveChecklist } from './checklist.js';
import { listCorrections } from './corrections.js';
import {
  createElection,
  deleteElection,
  editedDirectly,
  type Election,
  ELECTION_TYPES,
  type ElectionStatus,
  type ElectionType,
  getElection,
  listElections,
  purgeElection,
  updateElection,
} from './elections.js';
import {
  createInvitation,
  deleteInvitation,
  hashInvitationToken,
  holdsRole,
  INVITATION_DAYS,
  type InvitationSender,
  listInvitations,
  makeInvitationToken,
  operatorOf,
  revokeInvitation,
  revokeOthers,
} from './invitations.js';
import { localizedInput, localizedSchema } from './localized-input.js';
import { addRole, listMemberships, removeRole } from './members.js';
import {
  addReviewer,
  deleteMethodology,
  deleteReviewer,
  getMethodology,
  listDemandsOwners,
  methodologyIdOf,
  type ReviewerFields,
  saveMethodology,
  SOURCE_KINDS,
  type SourceKind,
  updateReviewer,
} from './methodology.js';
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  type OrganizationFields,
  organizationLogo,
  platformLanguages,
  setOrganizationLogo,
  sitesOf,
  updateOrganization,
} from './organizations.js';
import { workQueues } from './queues.js';
import { listRechecks } from './rechecks.js';
import {
  anonymizeReport,
  getReport,
  listReports,
  REPORT_STATUSES,
  reportCounts,
  type ReportStatus,
  triageReport,
} from './reports.js';
import { schemaRefusal } from './schema-refusal.js';
import {
  type ChangeResult,
  createDocument,
  deleteDocument,
  DOCUMENT_KINDS,
  type DocumentKind,
  listDocuments,
  updateDocument,
  updateSettings,
} from './settings.js';
import { signupCounts } from './signups.js';
import {
  createSite,
  getSite,
  listSites,
  setSiteActive,
  setSiteDetails,
  setSiteSettings,
  type SiteFields,
  type SiteSettings,
} from './sites.js';
import {
  type ArchiveDispatch,
  attachUpload,
  createSource,
  deleteSource,
  type ExtractionDispatch,
  listSources,
  markReplaced,
  openArchives,
  openExtractions,
  pendingExtraction,
  requestArchive,
  sourceCopy,
  type SourceFields,
  sourceForUpload,
  updateSource,
} from './sources.js';
import {
  createCriterion,
  createParty,
  type CriterionFields,
  deleteFrom,
  listCoreCriteria,
  listCriteria,
  listParties,
  type LogoUpload,
  type PartyFields,
  partyForLogo,
  partyLogoFile,
  publicImageFile,
  reorder,
  setPartyLogo,
  setProgrammeStatus,
  storeLogoFile,
  updateCriterion,
  updateParty,
} from './structure.js';
import { listTenants, tenantOverview } from './tenants.js';

/**
 * What the API refuses on its own, before or after the database has its say (editorial workflow §2.3): each a key
 * under `errors` in packages/i18n, like the database's refusals (database-errors.ts).
 */
export const API_REFUSAL_KEYS = [
  'notFound',
  'lastCountryAdmin',
  'notMember',
  'draftExists',
  'needsDefaultLanguage',
  'noMethodology',
  'holdsRole',
  'mailFailed',
  'tooSoon',
  'notForTokens',
  'notEnrolled',
  'cellChanged',
  'hasCopy',
  'tooLarge',
  'fileType',
  'otherType',
  'logoImage',
  'siteIcon',
  'restrictedAsset',
  'changeControlled',
  'fetchRefused',
  'fetchFailed',
  'fetchUnavailable',
  'noUrl',
  'noCopy',
  'hasArchive',
  'themeContrast',
] as const;
export type ApiRefusalKey = (typeof API_REFUSAL_KEYS)[number];

/**
 * Thrown inside a route's `withActor` transaction to refuse the request and roll back whatever it wrote, as the last
 * country admin's removal is.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 429,
    readonly key:
      ApiRefusalKey | 'forbidden' | 'invalid' | 'incomplete' | 'stale' | 'taken' | 'limit',
    /** The database constraint whose rule it applies early, so the admin points at the field as it would then. */
    readonly constraint?: string,
    /** The request body's field it is about, when no constraint names it (admin forms §1.2, PLAN R195). */
    readonly field?: string,
  ) {
    super(key);
  }
}

const SLUG = { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 63 } as const;
const UUID = {
  type: 'string',
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
} as const;
const ROLE = { type: 'string', enum: TENANT_ROLES } as const;

const TENANT_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG },
  required: ['tenant'],
} as const;
const MEMBER_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, userId: UUID },
  required: ['tenant', 'userId'],
} as const;
const ID_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, id: UUID },
  required: ['tenant', 'id'],
} as const;
const INVITATION_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, id: UUID },
  required: ['tenant', 'id'],
} as const;
const MEMBER_ROLE_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, userId: UUID, role: ROLE },
  required: ['tenant', 'userId', 'role'],
} as const;

const ORGANIZATION_PARAMS = {
  type: 'object',
  properties: { id: UUID },
  required: ['id'],
} as const;
/** A slot of a site's brand images (PLAN R195): one of those the public pages use. */
const BRAND_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, slot: { type: 'string', enum: BRAND_SLOT_NAMES } },
  required: ['tenant', 'slot'],
} as const;
/** An upload's file name, as the browser had it. */
const FILENAME_QUERY = {
  type: 'object',
  properties: { filename: { type: 'string', maxLength: 200 } },
} as const;

/** Optional text: null or blank leaves it unset. */
const OPTIONAL_TEXT = (maxLength: number) => ({ type: ['string', 'null'], maxLength }) as const;
const ORGANIZATION_BODY = {
  type: 'object',
  properties: {
    displayName: localizedSchema(200),
    legalName: { type: 'string', maxLength: 300 },
    taxId: OPTIONAL_TEXT(50),
    address: OPTIONAL_TEXT(500),
    registryEntry: OPTIONAL_TEXT(300),
    contactEmail: OPTIONAL_TEXT(254),
    privacyEmail: OPTIONAL_TEXT(254),
    url: OPTIONAL_TEXT(2048),
    newsletterUrl: OPTIONAL_TEXT(2048),
    isPauseaiChapter: { type: 'boolean' },
  },
  required: [
    'displayName',
    'legalName',
    'taxId',
    'address',
    'registryEntry',
    'contactEmail',
    'privacyEmail',
    'url',
    'newsletterUrl',
    'isPauseaiChapter',
  ],
  additionalProperties: false,
} as const;
type OrganizationBody = Omit<OrganizationFields, 'displayName'> & {
  displayName: Record<string, string>;
};

type TenantRole = (typeof TENANT_ROLES)[number];

export interface AdminDataOptions {
  /** The aiontheballot_admin role's pool; without it every route here answers 503. */
  admin?: Database;
  /** Names and emails, from Better Auth's tables; without it the members route answers 503. */
  profiles?: ProfileSource;
  /** The file store (ADR-0004); without it, uploading and reading sources' copies answers 503. */
  files?: FileStore;
  /** The worker's dispatch (R116); without it, copies are stored and their extraction waits. */
  extraction?: ExtractionDispatch;
  /** The fetcher (ADR-0007): copies by URL; without it, fetching one answers 503 and the admin offers only uploads. */
  fetcher?: FetcherClient;
  /** Archive snapshots (ADR-0007 §4), through the fetcher and the worker; without them, none is asked for. */
  archives?: ArchiveDispatch;
  /** Tells the public site's replicas a site changed (R151); without it they catch up within their minute. */
  revalidate?: (target: { tenant: string; election?: string }) => void;
  /** Invitations' accounts and email (A2); without them, inviting answers 503. */
  invitations?: { accounts: InvitedAccounts; send: InvitationSender };
  /** Password reset emails sent from the members page (PLAN R170); without them, sending one answers 503. */
  passwordLinks?: PasswordLinks;
  /** The admin's origin: a write must come from a page on it. */
  adminOrigin: string;
  /** Who a request acts for: a signed-in actor at aal2, or nobody (auth/session.ts). */
  actorFor: (request: FastifyRequest) => Promise<Actor | undefined>;
}

const ELECTION_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, election: SLUG },
  required: ['tenant', 'election'],
} as const;
const ELECTION_ID_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, election: SLUG, id: UUID },
  required: ['tenant', 'election', 'id'],
} as const;
const CELL_PAIR_PARAMS = {
  type: 'object',
  properties: { tenant: SLUG, election: SLUG, party: UUID, criterion: UUID },
  required: ['tenant', 'election', 'party', 'criterion'],
} as const;
/** Where in a video or audio clip a quote is said (C4.1): seconds, to the millisecond, as the columns hold them. */
const CLIP_SECONDS = { type: 'number', minimum: 0, maximum: 9_999_999 } as const;
const CELL_ITEM_PARAMS = <K extends string>(item: K) =>
  ({
    type: 'object',
    properties: { tenant: SLUG, election: SLUG, id: UUID, [item]: UUID },
    required: ['tenant', 'election', 'id', item],
  }) as const;
/** The content version a change was made against (C14). */
const VERSION = { type: 'integer', minimum: 0 } as const;
const VERSION_QUERY = {
  type: 'object',
  properties: { version: VERSION },
  required: ['version'],
} as const;
/** A cell's fields as its form sends them: the rating on any scale, which the database checks against the tenant's. */
const CELL_BODY = {
  type: 'object',
  properties: {
    version: VERSION,
    rating: { type: ['string', 'null'], enum: [...RATINGS, null] },
    summary: { anyOf: [localizedSchema(4000), { type: 'null' }] },
    changeKind: { type: ['string', 'null'], enum: ['update', 'correction', 'withdrawal', null] },
    publicNote: { anyOf: [localizedSchema(2000), { type: 'null' }] },
    // Optional, so a form that doesn't offer it (before the first publish, or an older admin) leaves it as it is.
    reportId: { anyOf: [UUID, { type: 'null' }] },
  },
  required: ['version', 'rating', 'summary', 'changeKind', 'publicNote'],
  additionalProperties: false,
} as const;
interface CellBody {
  version: number;
  rating: Rating | null;
  summary: Record<string, string> | null;
  changeKind: Exclude<ChangeKind, 'initial'> | null;
  publicNote: Record<string, string> | null;
  /** The right-of-reply report the draft answers (C10.4); absent, unchanged. */
  reportId?: string | null;
}
/** A source's fields (S1.1): the URL's scheme, a programme only of a party, are the database's to check. */
const SOURCE_BODY = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 500 },
    kind: { type: 'string', enum: SOURCE_KINDS },
    url: OPTIONAL_TEXT(2048),
    // Any language a party writes in, as app.locale has it: not only the app's own.
    language: { type: ['string', 'null'], pattern: '^[a-z]{2}(-[a-z]{2})?$' },
    partyId: { anyOf: [UUID, { type: 'null' }] },
    isProgramme: { type: 'boolean' },
  },
  required: ['title', 'kind', 'url', 'language', 'partyId', 'isProgramme'],
  additionalProperties: false,
} as const;
interface SourceBody {
  title: string;
  kind: SourceKind;
  url: string | null;
  language: string | null;
  partyId: string | null;
  isProgramme: boolean;
}
/** What a copy may be (S2.2): copy-types.ts, shared with the fetcher. */
const UPLOAD_TYPES = COPY_TYPES;
/** The largest copy (S2.2), as the files table's check has it. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const isUploadType = isCopyType;

/**
 * What a quote's attestation file may be (C4.1; PLAN R171): a screenshot (an image a browser draws, never SVG), or a
 * clip of video or audio. Never rendered on the admin's origin: members download it.
 */
const ATTESTATION_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/webm',
] as const;
/** Each one's extension, so a downloaded file opens as what it is. */
const ATTESTATION_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
};
/** What a party's logo may be (PLAN R142): an image a browser draws, never SVG, which can carry script. */
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** A logo's limits, as brand images' (PLAN R59): 2 MB, and no side over 4,096 pixels. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_SIDE = 4096;

/** An upload's type, if it is one a logo or a brand image may be (PLAN R142, R195). */
const logoTypeOf = (request: FastifyRequest): (typeof LOGO_TYPES)[number] | undefined => {
  const contentType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  return (LOGO_TYPES as readonly (string | undefined)[]).includes(contentType)
    ? (contentType as (typeof LOGO_TYPES)[number])
    : undefined;
};

/**
 * An image upload's bytes (a party's logo, a site's brand image, an organization's logo; PLAN R142, R195), read whole,
 * at most 2 MB and refused as soon as it passes that, then checked by their own header: the type they were sent as, at
 * least a pixel, no side over 4,096. The caller checks its type, the user's rate and role before calling, so a refused
 * upload is never read.
 */
const readImage = async (
  request: FastifyRequest<{ Body: IncomingMessage }>,
  contentType: (typeof LOGO_TYPES)[number],
): Promise<Uint8Array> => {
  if (typeof request.body?.iterator !== 'function') {
    throw new Refusal(415, 'logoImage');
  }
  if (Number(request.headers['content-length']) > MAX_LOGO_BYTES) {
    throw new Refusal(413, 'tooLarge');
  }
  // Small enough to hold: read whole, so its header can be checked before anything is stored.
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request.body.iterator({ destroyOnReturn: false })) {
      size += (chunk as Buffer).byteLength;
      if (size > MAX_LOGO_BYTES) {
        throw new Refusal(413, 'tooLarge');
      }
      chunks.push(chunk as Buffer);
    }
  } catch (error) {
    // The browser went away mid-upload: nothing was kept, and nobody is there to tell.
    if (!(error instanceof Refusal) && (request.raw.destroyed || request.raw.readableAborted)) {
      throw new Refusal(400, 'invalid');
    }
    throw error;
  }
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const image = imageSize(bytes);
  if (
    !image ||
    image.type !== contentType ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_LOGO_SIDE ||
    image.height > MAX_LOGO_SIDE
  ) {
    throw new Refusal(415, 'logoImage');
  }
  return bytes;
};

/** A comment, or a rejection's note (C8, C9), and for a rejection the version the reviewer saw. */
const NOTE_BODY = (withVersion: boolean) =>
  ({
    type: 'object',
    properties: {
      ...(withVersion ? { version: VERSION } : {}),
      note: { type: 'string', maxLength: 4000 },
    },
    required: withVersion ? ['version', 'note'] : ['note'],
    additionalProperties: false,
  }) as const;

/**
 * Slugs and territory codes in bodies are checked by the database, whose constraint names the field (R78); the schemas
 * only bound their size. A date is a day.
 */
const BODY_SLUG = { type: 'string', maxLength: 200 } as const;
const DAY = { type: ['string', 'null'], pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' } as const;

const SITE_PARAMS = {
  type: 'object',
  properties: { site: SLUG },
  required: ['site'],
} as const;
/** A new site's fields (R129): the database checks the slug, the country code and the retention's bounds. */
const SITE_BODY = {
  type: 'object',
  properties: {
    slug: BODY_SLUG,
    name: localizedSchema(200),
    countryCode: { type: 'string', maxLength: 10 },
    defaultLocale: { type: 'string', maxLength: 10 },
    enabledLocales: { type: 'array', items: { type: 'string', maxLength: 10 }, maxItems: 20 },
    methodologyKind: { type: 'string', enum: ['demands', 'descriptive'] },
    operatorId: UUID,
    // The column's own bounds, so a number past Postgres's integers is a refusal, not a fault.
    reportRetentionDays: { type: 'integer', minimum: 1, maximum: 36_500 },
  },
  required: [
    'slug',
    'name',
    'countryCode',
    'defaultLocale',
    'enabledLocales',
    'methodologyKind',
    'operatorId',
    'reportRetentionDays',
  ],
  additionalProperties: false,
} as const;
type SiteBody = Omit<SiteFields, 'name'> & { name: Record<string, string> };
/** A site's details a platform admin changes (PLAN R195): never its main language, slug or country. */
const SITE_DETAILS_BODY = {
  type: 'object',
  properties: {
    name: localizedSchema(200),
    enabledLocales: { type: 'array', items: { type: 'string', maxLength: 10 }, maxItems: 20 },
    operatorId: UUID,
  },
  required: ['name', 'enabledLocales', 'operatorId'],
  additionalProperties: false,
} as const;
const SITE_ACTIVE_BODY = {
  type: 'object',
  properties: { active: { type: 'boolean' } },
  required: ['active'],
  additionalProperties: false,
} as const;
/** A site's public settings (PLAN R135), one route each. */
const SITE_OPEN_BODY = {
  type: 'object',
  properties: { open: { type: 'boolean' } },
  required: ['open'],
  additionalProperties: false,
} as const;
const SITE_INDEXING_BODY = {
  type: 'object',
  properties: { indexed: { type: 'boolean' } },
  required: ['indexed'],
  additionalProperties: false,
} as const;
const SITE_ANALYTICS_BODY = {
  type: 'object',
  properties: {
    // A Plausible site's script file, from its installation snippet; the database checks it too.
    plausibleScript: { type: ['string', 'null'], pattern: '^pa-[A-Za-z0-9_-]{1,100}\\.js$' },
  },
  required: ['plausibleScript'],
  additionalProperties: false,
} as const;

interface ElectionBody {
  slug?: string;
  type?: ElectionType;
  territoryCode?: string | null;
  name?: Record<string, string>;
  date?: string | null;
  announced?: boolean;
  requireSecondReviewer?: boolean;
  status?: 'preview' | 'live' | 'archived';
  frozenFrom?: string | null;
  frozenUntil?: string | null;
}
/**
 * An instant, as ISO 8601 with its offset and a four-digit year: never `infinity` or a year JavaScript's dates can't
 * hold, which the database would take and the API could then never read back.
 */
const INSTANT = {
  type: ['string', 'null'],
  pattern:
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$',
} as const;
const ELECTION_BODY = {
  type: 'object',
  properties: {
    slug: BODY_SLUG,
    type: { type: 'string', enum: ELECTION_TYPES },
    territoryCode: { type: ['string', 'null'], maxLength: 10 },
    name: localizedSchema(200),
    date: DAY,
    announced: { type: 'boolean' },
    requireSecondReviewer: { type: 'boolean' },
    status: { type: 'string', enum: ['preview', 'live', 'archived'] },
    frozenFrom: INSTANT,
    frozenUntil: INSTANT,
  },
  additionalProperties: false,
} as const;

interface MethodologyBody {
  demandsOwnerId: string | null;
  body: Record<string, string>;
  admissibleSourceKinds: SourceKind[];
  notMentionedSourceKinds: SourceKind[];
}
const SOURCE_KINDS_SCHEMA = {
  type: 'array',
  items: { type: 'string', enum: SOURCE_KINDS },
  uniqueItems: true,
  maxItems: SOURCE_KINDS.length,
} as const;
const METHODOLOGY_BODY = {
  type: 'object',
  properties: {
    demandsOwnerId: { anyOf: [UUID, { type: 'null' }] },
    body: localizedSchema(100_000),
    admissibleSourceKinds: SOURCE_KINDS_SCHEMA,
    notMentionedSourceKinds: SOURCE_KINDS_SCHEMA,
  },
  required: ['demandsOwnerId', 'body', 'admissibleSourceKinds', 'notMentionedSourceKinds'],
  additionalProperties: false,
} as const;

interface ReviewerBody {
  name: string;
  affiliation: string;
  displayOrder: number;
}
const REVIEWER_BODY = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 200 },
    affiliation: { type: 'string', maxLength: 300 },
    displayOrder: { type: 'integer', minimum: 0, maximum: 10_000 },
  },
  required: ['name', 'affiliation', 'displayOrder'],
  additionalProperties: false,
} as const;

interface PartyBody {
  slug: string;
  name: Record<string, string>;
  shortName: Record<string, string>;
  colour: string | null;
  website: string | null;
  territoryCodes: string[] | null;
}
const PARTY_BODY = {
  type: 'object',
  properties: {
    slug: BODY_SLUG,
    name: localizedSchema(200),
    shortName: localizedSchema(60),
    colour: { type: ['string', 'null'], maxLength: 7 },
    website: { type: ['string', 'null'], maxLength: 500 },
    territoryCodes: {
      type: ['array', 'null'],
      items: { type: 'string', maxLength: 10 },
      maxItems: 100,
    },
  },
  required: ['slug', 'name', 'shortName', 'colour', 'website', 'territoryCodes'],
  additionalProperties: false,
} as const;

interface CriterionBody {
  slug: string;
  title: Record<string, string>;
  shortTitle: Record<string, string>;
  description: Record<string, string>;
  coreCriterionId: string | null;
}
const CRITERION_BODY = {
  type: 'object',
  properties: {
    slug: BODY_SLUG,
    title: localizedSchema(300),
    shortTitle: localizedSchema(40),
    description: localizedSchema(5_000),
    coreCriterionId: { anyOf: [UUID, { type: 'null' }] },
  },
  required: ['slug', 'title', 'shortTitle', 'description', 'coreCriterionId'],
  additionalProperties: false,
} as const;

/** Localized text a column may leave empty: in the tenant's languages only, and null when there is none. */
const optionalLocalized = (value: Record<string, string>, access: Access): Localized | null => {
  const input = localizedInput(value, access.enabledLocales);
  if (input === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  return input === 'empty' ? null : input;
};

/** A reviewer as the form sends it: names as typed but trimmed, and refused blank (they will be public). */
const reviewerFields = (body: ReviewerBody): ReviewerFields => {
  const name = body.name.trim();
  if (name === '') {
    throw new Refusal(422, 'incomplete');
  }
  return { name, affiliation: body.affiliation.trim(), displayOrder: body.displayOrder };
};

/** A party as the form sends it, normalized to how its columns store it: empty strings and lists are none. */
const partyFields = (body: PartyBody, access: Access): PartyFields => {
  const territories = (body.territoryCodes ?? [])
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '');
  return {
    slug: body.slug.trim(),
    name: requiredLocalized(body.name, access),
    shortName: requiredLocalized(body.shortName, access),
    colour:
      body.colour === null || body.colour.trim() === '' ? null : body.colour.trim().toLowerCase(),
    website: body.website === null || body.website.trim() === '' ? null : body.website.trim(),
    territoryCodes: territories.length > 0 ? [...new Set(territories)] : null,
  };
};

const criterionFields = (body: CriterionBody, access: Access): CriterionFields => ({
  slug: body.slug.trim(),
  title: requiredLocalized(body.title, access),
  shortTitle: optionalLocalized(body.shortTitle, access),
  description: requiredLocalized(body.description, access),
  coreCriterionId: body.coreCriterionId,
});

/** What the actor may do in an election's tenant, for the admin to offer; the database decides again. */
const capabilities = (access: Access) => ({
  canEdit: holds(access, 'country_admin', 'editor'),
  canAdminister: holds(access, 'country_admin'),
  platformAdmin: access.platformAdmin,
});

/** A policy text's length in one language at most: long enough for a privacy policy. */
const DOCUMENT_MAX_LENGTH = 100_000;

/** Turns a write that changed nothing into its refusal (each data function says why). */
const refuseUnless = (result: ChangeResult): void => {
  if (result === 'not-found') {
    throw new Refusal(404, 'notFound');
  }
  if (result === 'forbidden') {
    throw new Refusal(403, 'forbidden');
  }
  if (result === 'stale') {
    throw new Refusal(409, 'stale');
  }
};

/** An organization's logo change as `refuseUnless` does, and 'otherType' as a conflict (the reviews of R200). */
const refuseUnlessLogo = (result: ChangeResult | 'otherType'): void => {
  if (result === 'otherType') {
    throw new Refusal(409, result);
  }
  refuseUnless(result);
};

/** Better Auth's own rule for an address, so an invitation goes only where an account can be made. */
const INVITABLE_EMAIL = z.email();

/** Turns a cell change that didn't happen into its refusal: gone, or changed by someone else first (C14). */
const refuseUnlessCell = (result: CellChange): void => {
  if (result === 'not-found') {
    throw new Refusal(404, 'notFound');
  }
  if (result === 'stale') {
    throw new Refusal(409, 'cellChanged');
  }
  if (result === 'forbidden') {
    throw new Refusal(403, 'forbidden');
  }
};

/**
 * The cell's version once a change of its content went through (admin forms §2, PLAN R190), read in the change's own
 * transaction, which still holds the cell's lock: the version the page that made the change adopts as its own, keeping
 * the text being typed in its draft, which a change by someone else would make stale.
 */
const cellVersion = async (trx: Transaction<DB>, cellId: string): Promise<number> =>
  (
    await trx
      .selectFrom('app.assessments')
      .select('content_version')
      .where('id', '=', cellId)
      .executeTakeFirstOrThrow()
  ).content_version;

/** Optional localized text, in the tenant's languages only: null when blank, which a draft may be. */
const optionalLocalizedInput = (
  value: Record<string, string> | null,
  access: Access,
): Localized | null => {
  if (value === null) {
    return null;
  }
  const input = localizedInput(value, access.enabledLocales);
  if (input === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  return input === 'empty' ? null : input;
};

/** A source's fields as the database takes them: the title trimmed, a blank URL none, a language the platform's. */
const sourceFields = (body: SourceBody): SourceFields => {
  const title = body.title.trim();
  if (title === '') {
    throw new Refusal(422, 'incomplete');
  }
  return {
    title,
    kind: body.kind,
    url: optionalText(body.url),
    language: body.language,
    partyId: body.partyId,
    isProgramme: body.isProgramme,
  };
};

/** A change request as the admin sends it (CR1): what it changes, the value, the public note. */
interface ChangeBody {
  action: ChangeAction;
  targetKind: ChangeTarget;
  targetId: string | null;
  field: string | null;
  value?: unknown;
  /** An update of several fields at once (PLAN R183), with no single `field`: each field and its new value. */
  values?: Record<string, unknown>;
  publicNote: Record<string, string>;
  apply?: boolean;
  /** The right-of-reply report that prompted it (CR1.8), one of the site's the proposer can see. */
  reportId?: string | null;
}
const CHANGE_BODY = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: CHANGE_ACTIONS },
    targetKind: { type: 'string', enum: CHANGE_TARGETS },
    targetId: { anyOf: [UUID, { type: 'null' }] },
    field: { type: ['string', 'null'], maxLength: 64 },
    // Any value: the database normalizes it to the column and checks it as it checks the column.
    value: {},
    values: { type: 'object', minProperties: 1, maxProperties: 16 },
    publicNote: localizedSchema(2_000),
    apply: { type: 'boolean' },
    reportId: { anyOf: [UUID, { type: 'null' }] },
  },
  required: ['action', 'targetKind', 'targetId', 'field', 'publicNote'],
  additionalProperties: false,
} as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** How a change request takes one column's value: checked and normalized as the draft's own forms take it (E4). */
type ColumnRule = (value: unknown, access: Access) => unknown;

/** A text's length as the JSON schemas count it (ajv's `maxLength`): in code points. */
const lengthOf = (text: string): number => Array.from(text).length;

/** Localized text that will be public: the site's languages, `max` characters each, the default one among them. */
const publicLocalized =
  (max: number): ColumnRule =>
  (value, access) => {
    if (
      !isPlainObject(value) ||
      Object.values(value).some((text) => typeof text !== 'string' || lengthOf(text) > max)
    ) {
      throw new Refusal(400, 'invalid');
    }
    return publishable(requiredLocalized(value as Record<string, string>, access), access, true);
  };

/** Plain text that will be public (a reviewer's name, a slug): trimmed, and blank only where `blank` allows. */
const plainText =
  (max: number, blank = false): ColumnRule =>
  (value) => {
    if (typeof value !== 'string' || lengthOf(value) > max) {
      throw new Refusal(400, 'invalid');
    }
    const trimmed = value.trim();
    if (trimmed === '' && !blank) {
      throw new Refusal(422, 'incomplete');
    }
    return trimmed;
  };

/**
 * Text a column may be without (a colour, a website): blank is none, and anything else must have the shape the
 * column's check wants, which a change request's value meets only when it is approved; refused now, as that check
 * would refuse it (`constraint`).
 */
const optionalString =
  (max: number, shape: RegExp, constraint: string, lowercase = false): ColumnRule =>
  (value) => {
    if (value === null) {
      return null;
    }
    if (typeof value !== 'string' || lengthOf(value) > max) {
      throw new Refusal(400, 'invalid');
    }
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const taken = lowercase ? trimmed.toLowerCase() : trimmed;
    if (!shape.test(taken)) {
      throw new Refusal(422, 'incomplete', constraint);
    }
    return taken;
  };

/** A place in a list, within the draft forms' bounds. */
const listPlace: ColumnRule = (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Refusal(400, 'invalid');
  }
  return value;
};

const UUID_PATTERN = new RegExp(UUID.pattern, 'u');
const idOrNone: ColumnRule = (value) => {
  if (value !== null && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
    throw new Refusal(400, 'invalid');
  }
  return value;
};

/** A day, as the draft's form takes it: never `infinity` or a year past four digits, which a date column takes. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const dayOrNone: ColumnRule = (value) => {
  if (value !== null && (typeof value !== 'string' || !DAY_PATTERN.test(value))) {
    throw new Refusal(400, 'invalid');
  }
  return value;
};

/**
 * Territory codes as a party's form takes them: a flat list, in capitals, each once; none when empty. Each must be an
 * ISO 3166-2 code inside the site's country, as the column's check and the structure rules want.
 */
const TERRITORY = /^[A-Z]{2}-[A-Z\d]{1,3}$/u;
const territoryCodes: ColumnRule = (value, access) => {
  if (value === null) {
    return null;
  }
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some((code) => typeof code !== 'string' || lengthOf(code) > 10)
  ) {
    throw new Refusal(400, 'invalid');
  }
  const codes = (value as string[])
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '');
  if (codes.some((code) => !TERRITORY.test(code) || !code.startsWith(`${access.countryCode}-`))) {
    throw new Refusal(422, 'incomplete', 'parties_territory_codes_check');
  }
  return codes.length > 0 ? [...new Set(codes)] : null;
};

/** Source kinds, each once; at least one, as the methodology's check wants. */
const sourceKindList: ColumnRule = (value) => {
  if (
    !Array.isArray(value) ||
    value.some((kind) => !(SOURCE_KINDS as readonly unknown[]).includes(kind)) ||
    new Set(value).size !== value.length
  ) {
    throw new Refusal(400, 'invalid');
  }
  if (value.length === 0) {
    throw new Refusal(422, 'incomplete', 'methodologies_check1');
  }
  return value;
};

/**
 * Every change-controlled column (CHANGEABLE) and how a request takes its value: as the draft's routes do, so nothing
 * reaches a live election that a draft would have refused (a blank name, a two-level list of codes, a date past
 * JavaScript's, a public text without the default language). The database checks the rest when it is approved.
 */
const COLUMN_RULES: Readonly<Record<ChangeTarget, Readonly<Record<string, ColumnRule>>>> = {
  election: { name: publicLocalized(200), election_date: dayOrNone },
  methodology: {
    demands_owner_id: idOrNone,
    body: publicLocalized(100_000),
    admissible_source_kinds: sourceKindList,
    not_mentioned_source_kinds: sourceKindList,
  },
  methodology_reviewer: {
    name: plainText(200),
    affiliation: plainText(300, true),
    display_order: listPlace,
  },
  party: {
    slug: plainText(200),
    name: publicLocalized(200),
    short_name: publicLocalized(60),
    logo_file_id: idOrNone,
    colour: optionalString(7, /^#[\da-f]{6}$/u, 'parties_colour_check', true),
    display_order: listPlace,
    website: optionalString(500, /^https?:\/\//u, 'parties_website_check'),
    territory_codes: territoryCodes,
  },
  // A live election's criteria all have a short title (migration criteria_short_title).
  criterion: {
    slug: plainText(200),
    title: publicLocalized(300),
    short_title: publicLocalized(40),
    description: publicLocalized(5_000),
    display_order: listPlace,
    core_criterion_id: idOrNone,
  },
};

/** What a new row can't be without; the other columns have defaults or may be none, and its place is the API's. */
const NEEDED_TO_ADD: Readonly<Partial<Record<ChangeTarget, readonly string[]>>> = {
  methodology_reviewer: ['name', 'affiliation'],
  party: ['slug', 'name', 'short_name'],
  criterion: ['slug', 'title', 'short_title', 'description'],
};

/**
 * A change request as the database takes it: only what its change rules allow for the target (CHANGEABLE), each value
 * as its column's rule takes it, and the public note in the default language, so what would be refused when approved
 * is mostly refused when proposed. Not everything: a slug taken meanwhile, a demands owner the methodology's kind
 * doesn't allow and a logo file are the database's to refuse, at approval. It checks it all again then, the previous
 * value included, which it reads itself.
 */
const changeProposal = (body: ChangeBody, access: Access): Proposal => {
  const allowed = CHANGEABLE[body.targetKind];
  const take = (column: string, value: unknown): unknown => {
    const rule = COLUMN_RULES[body.targetKind][column];
    if (!rule) {
      throw new Refusal(400, 'invalid');
    }
    return rule(value, access);
  };
  const publicNote = publishable(requiredLocalized(body.publicNote, access), access, true);
  const { values, ...request } = body;
  if (body.action === 'update' && body.field === null) {
    // Several fields at once (PLAN R183): each one the target changes through a request, each taken as on its own.
    const fields = isPlainObject(values) ? Object.entries(values) : [];
    if (
      !body.targetId ||
      body.value !== undefined ||
      fields.length === 0 ||
      fields.some(([column]) => !allowed.update.includes(column))
    ) {
      throw new Refusal(400, 'invalid');
    }
    return {
      ...request,
      publicNote,
      value: Object.fromEntries(fields.map(([column, value]) => [column, take(column, value)])),
    };
  }
  if (values !== undefined) {
    throw new Refusal(400, 'invalid');
  }
  if (body.action === 'update') {
    if (
      !body.targetId ||
      !body.field ||
      !allowed.update.includes(body.field) ||
      body.value === undefined
    ) {
      throw new Refusal(400, 'invalid');
    }
    return { ...request, publicNote, value: take(body.field, body.value) };
  }
  if (!allowed.add) {
    throw new Refusal(400, 'invalid');
  }
  if (body.action === 'retire') {
    if (!body.targetId || body.field !== null || body.value !== undefined) {
      throw new Refusal(400, 'invalid');
    }
    return { ...request, publicNote };
  }
  if (body.targetId !== null || body.field !== null || !isPlainObject(body.value)) {
    throw new Refusal(400, 'invalid');
  }
  const added = body.value;
  const columns = Object.entries(added);
  if (columns.some(([column]) => !allowed.add?.includes(column) || column === 'display_order')) {
    throw new Refusal(400, 'invalid');
  }
  if ((NEEDED_TO_ADD[body.targetKind] ?? []).some((column) => !Object.hasOwn(added, column))) {
    throw new Refusal(422, 'incomplete');
  }
  return {
    ...request,
    publicNote,
    value: Object.fromEntries(columns.map(([column, value]) => [column, take(column, value)])),
  };
};

/** A note that must say something: a comment, or why a cell goes back (C8.1). */
const requiredNote = (note: string): string => {
  const trimmed = note.trim();
  if (trimmed === '') {
    throw new Refusal(422, 'incomplete');
  }
  return trimmed;
};

/** Localized text a column requires: in the tenant's languages only, and with text in at least one. */
const requiredLocalized = (value: Record<string, string>, access: Access): Localized => {
  const input = localizedInput(value, access.enabledLocales);
  if (input === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  if (input === 'empty') {
    throw new Refusal(422, 'incomplete');
  }
  return input;
};

/**
 * Text that is to be published must have the tenant's default language (the trigger's rule too, which names nothing):
 * this says so, so the admin can point at that language (editorial workflow §2.3).
 */
const publishable = (body: Localized, access: Access, publish: boolean): Localized => {
  if (publish && !Object.hasOwn(body, access.defaultLocale)) {
    throw new Refusal(422, 'needsDefaultLanguage');
  }
  return body;
};

/** Text as the column takes it: trimmed, and null when blank. */
const optionalText = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * A file's name as given (an upload's) or found (a fetched copy's), without control or formatting characters (a NUL
 * the database refuses, a direction override that disguises the extension), if anything is left.
 */
const fileName = (value: string | null): string | null =>
  optionalText(value?.replaceAll(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 200) ?? null);

/** A fetched copy's file name (S2.1): the last segment of where it came from, decoded, if it names anything. */
const fetchedFilename = (finalUrl: string): string | null => {
  const segment = URL.parse(finalUrl)?.pathname.split('/').pop() ?? '';
  let name: string;
  try {
    name = decodeURIComponent(segment);
  } catch {
    name = segment;
  }
  return fileName(name);
};

/**
 * An organization's fields as the database takes them (P2.2): emails in lowercase, which their checks require; the
 * checks themselves (an email's shape, `https://` links) stay the database's. The name may be in any site's language.
 */
const organizationFields = (
  body: OrganizationBody,
  languages: readonly string[],
): OrganizationFields => {
  const displayName = localizedInput(body.displayName, languages);
  if (displayName === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  const legalName = optionalText(body.legalName);
  if (displayName === 'empty' || legalName === null) {
    throw new Refusal(422, 'incomplete');
  }
  return {
    displayName,
    legalName,
    taxId: optionalText(body.taxId),
    address: optionalText(body.address),
    registryEntry: optionalText(body.registryEntry),
    contactEmail: optionalText(body.contactEmail)?.toLowerCase() ?? null,
    privacyEmail: optionalText(body.privacyEmail)?.toLowerCase() ?? null,
    url: optionalText(body.url),
    newsletterUrl: optionalText(body.newsletterUrl),
    isPauseaiChapter: body.isPauseaiChapter,
  };
};

/**
 * A new site's fields as the database takes them (R129): its languages are the platform's (the messages it has), the
 * default among them, and its name is in those languages, with text in at least one. The country code is uppercased;
 * its shape, the slug's and the retention's bounds stay the database's to check.
 */
const siteFields = (body: SiteBody): SiteFields => {
  const enabledLocales = [...new Set([body.defaultLocale, ...body.enabledLocales])];
  if (!enabledLocales.every(isLocale)) {
    throw new Refusal(400, 'invalid');
  }
  const name = localizedInput(body.name, enabledLocales);
  if (name === 'invalid') {
    throw new Refusal(400, 'invalid');
  }
  if (name === 'empty') {
    throw new Refusal(422, 'incomplete');
  }
  const slug = body.slug.trim();
  // `new` is the new-site form's own address in the admin (/platform/sites/new), which a site's page would never reach.
  if (slug === 'new') {
    throw new Refusal(409, 'taken');
  }
  return {
    ...body,
    slug,
    name,
    countryCode: body.countryCode.trim().toUpperCase(),
    enabledLocales,
  };
};

/** The site the path names, or a 404 if there is none. */
const siteFor = async (trx: Transaction<DB>, slug: string) => {
  const site = await getSite(trx, slug);
  if (!site) {
    throw new Refusal(404, 'notFound');
  }
  return site;
};

/** The methods that write: a HEAD (Fastify's own, for every GET) never does. */
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The routes a member's token reaches (ADR-0008, PLAN R203, R213), by method and pattern: reading the member's sites,
 * elections, parties and criteria, and drafting: creating an election (always a draft), creating, editing and ordering
 * its parties, their logos and its criteria, and proposing changes to a live one and withdrawing them. Every other
 * route refuses a token, whatever its member may do there; the database bounds what these write (needs_a_person).
 */
export const TOKEN_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/tenants',
  'GET /api/t/:tenant',
  'GET /api/t/:tenant/elections',
  'POST /api/t/:tenant/elections',
  'GET /api/t/:tenant/e/:election',
  'GET /api/t/:tenant/e/:election/parties',
  'POST /api/t/:tenant/e/:election/parties',
  'PUT /api/t/:tenant/e/:election/parties/:id',
  'PUT /api/t/:tenant/e/:election/parties/order',
  'GET /api/t/:tenant/e/:election/parties/:id/logo',
  'PUT /api/t/:tenant/e/:election/parties/:id/logo',
  'PUT /api/t/:tenant/e/:election/parties/:id/proposed-logo',
  // Criteria, in words a person approved; never deleted (PLAN R213).
  'GET /api/t/:tenant/e/:election/criteria',
  'POST /api/t/:tenant/e/:election/criteria',
  'PUT /api/t/:tenant/e/:election/criteria/:id',
  'PUT /api/t/:tenant/e/:election/criteria/order',
  'GET /api/t/:tenant/e/:election/changes',
  'POST /api/t/:tenant/e/:election/changes',
  'DELETE /api/t/:tenant/e/:election/changes/:id',
]);

const tokenMayReach = (request: FastifyRequest): boolean =>
  TOKEN_ROUTES.has(
    `${request.method === 'HEAD' ? 'GET' : request.method} ${request.routeOptions.url ?? ''}`,
  );

/**
 * The platform screens are for platform admins (editorial workflow §13.15, W6): anyone else gets a 404, as for a page
 * they can't open. Writes are RLS's to refuse all the same.
 */
const platformOnly = async (trx: Transaction<DB>, actor: Actor): Promise<void> => {
  if (!(await isPlatformAdmin(trx, actor.userId))) {
    throw new Refusal(404, 'notFound');
  }
};

/** The tenant and election the path names, or a 404 for either if RLS hides it (editorial workflow §2.1). */
const electionFor = async (
  trx: Transaction<DB>,
  actor: Actor,
  params: { tenant: string; election: string },
): Promise<{ access: Access; election: Election }> => {
  const access = await tenantFor(trx, actor, params.tenant);
  const election = await getElection(trx, access.tenantId, params.election);
  if (!election) {
    throw new Refusal(404, 'notFound');
  }
  return { access, election };
};

/** The tenant the path names, or a 404 for one RLS hides (editorial workflow §2.1). */
const tenantFor = async (trx: Transaction<DB>, actor: Actor, slug: string): Promise<Access> => {
  const access = await accessTo(trx, actor.userId, slug);
  if (!access) {
    throw new Refusal(404, 'notFound');
  }
  return access;
};

/**
 * The signed-in data routes under `/api` (ADR-0003 §1): every read and write runs in one `withActor` transaction as
 * aiontheballot_admin, so RLS and the triggers decide (ADR-0002 §3); what the routes check besides only shapes the
 * answer.
 */
export const adminDataRoutes =
  ({
    admin,
    profiles,
    invitations,
    passwordLinks,
    files,
    extraction,
    fetcher,
    archives,
    revalidate,
    adminOrigin,
    actorFor,
  }: AdminDataOptions) =>
  async (scope: FastifyInstance): Promise<void> => {
    // A tool's token reaches only its routes (TOKEN_ROUTES): refused here, before the request is even read, whatever
    // it carries, so no other route depends on remembering to check. Whether the token stands for anyone is
    // `actorFor`'s to say.
    scope.addHook('onRequest', async (request, reply) => {
      if (request.headers.authorization !== undefined && !tokenMayReach(request)) {
        return reply.code(403).send({ error: 'notForTokens' });
      }
    });
    // A request its schema refuses: `invalid`, and the body's field at fault, which the admin marks (admin forms
    // §1.2, PLAN R189). Any other error goes on to Fastify's own handler.
    scope.setErrorHandler(async (error, _request, reply) => {
      const refusal = schemaRefusal(error);
      if (!refusal) {
        throw error;
      }
      return reply.code(400).send(refusal);
    });

    /**
     * Runs `run` for the signed-in actor. A write must come from a page on the admin's origin, which every browser
     * names in `Origin` on such requests: with SameSite=Lax cookies and JSON-only bodies, a cross-site page can't
     * send one with the session anyway, and this refuses it outright. A refusal, the API's or the database's, becomes
     * its answer (§2.3); anything else is a fault, reported without the request's body.
     */
    // Invitation emails per inviter and day (A2): enough for a team, too few for a spammer with a stolen account.
    const allowInvitation = createRateLimiter({ limit: 50, windowMs: 24 * 60 * 60_000 });

    // The live match's limits (C2.6): requests per member and minute, and the sources' prepared text it keeps.
    const allowMatch = createRateLimiter({ limit: 120, windowMs: 60_000 });
    // Asking the worker again for a source's text (S3): a button press now and then, per member and minute.
    const allowExtraction = createRateLimiter({ limit: 10, windowMs: 60_000 });
    // Party logos (R142): each replaced one's bytes stay on the volume until the sweep's grace period ends, so a
    // member may store a few dozen an hour, not thousands.
    const allowLogo = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });
    // Attestation files (C4.1, PLAN R171): the same, for the same reason; a replaced one's bytes stay until swept.
    const allowAttestationFile = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });
    // Copies by URL and snapshots (ADR-0007 §5): each a request to a party's site or to the archive, which limits
    // captures per URL; a few dozen an hour per member is plenty.
    const allowFetch = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });
    const allowArchive = createRateLimiter({ limit: 30, windowMs: 60 * 60_000 });
    const preparedSources = new Map<string, PreparedSource>();
    const keepPrepared = (sourceId: string, prepared: PreparedSource) => {
      if (preparedSources.size >= 50) {
        const oldest = preparedSources.keys().next().value;
        if (oldest !== undefined) {
          preparedSources.delete(oldest);
        }
      }
      preparedSources.set(sourceId, prepared);
    };

    // After the write committed and its answer is on its way: never a reason to fail the request.
    const tellPublicSite = (target: { tenant: string; election?: string }) => {
      try {
        revalidate?.(target);
      } catch (error) {
        captureException(error);
      }
    };

    const signedIn = async (
      request: FastifyRequest,
      reply: FastifyReply,
      run: (db: Database, actor: Actor) => Promise<unknown>,
      // Whether the request may change what the public sees: every write method, unless the route says otherwise.
      { writes = WRITES.has(request.method) }: { writes?: boolean } = {},
    ): Promise<unknown> => {
      if (!admin) {
        return reply.code(503).send({ error: 'Admin data is not configured' });
      }
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      // A tool's request (one of TOKEN_ROUTES, the hook above) carries no cookie (actorFor), so no other site's page can
      // send it for someone: the Origin check, which stops exactly that, is for the member's session.
      if (
        actor.tokenId === undefined &&
        request.method !== 'GET' &&
        request.headers.origin !== adminOrigin
      ) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      let answer: unknown;
      try {
        answer = await run(admin, actor);
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.status).send({
            error: error.key,
            ...(error.constraint === undefined ? {} : { constraint: error.constraint }),
            ...(error.field === undefined ? {} : { field: error.field }),
          });
        }
        const refusal = databaseRefusal(error);
        if (refusal.report) {
          // A database error is reported by its SQLSTATE and where it came from, never its message, which can quote
          // what was written; anything else (a bug in the API) as it is.
          const { code, routine } = (error ?? {}) as { code?: unknown; routine?: unknown };
          request.log.error(
            { code, routine, constraint: refusal.constraint },
            'Admin request failed',
          );
          captureException(
            typeof code === 'string'
              ? new Error(`Admin request failed: SQLSTATE ${code} in ${String(routine)}`)
              : error,
          );
        }
        return reply.code(refusal.status).send({
          error: refusal.error,
          ...(refusal.constraint === undefined ? {} : { constraint: refusal.constraint }),
        });
      }
      // A write that went through: the public site refetches the site it touched, and the election (R151). Any
      // write, since what the public shows changes with many of them; one that changed nothing costs a refetch.
      if (writes && reply.statusCode < 400) {
        const params = (request.params ?? {}) as {
          tenant?: unknown;
          site?: unknown;
          election?: unknown;
        };
        const tenant = typeof params.tenant === 'string' ? params.tenant : params.site;
        if (typeof tenant === 'string') {
          tellPublicSite({
            tenant,
            ...(typeof params.election === 'string' ? { election: params.election } : {}),
          });
        }
      }
      return answer;
    };

    // The tenants the user may open, and whether they may open any (A6: a platform admin lands on the list).
    scope.get('/tenants', async (request, reply) =>
      signedIn(request, reply, (db, actor) =>
        withActor(db, actor, async (trx) => ({
          tenants: await listTenants(trx),
          platformAdmin: await isPlatformAdmin(trx, actor.userId),
        })),
      ),
    );

    // A tenant's screen header and settings, with what the actor holds there.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) =>
            tenantOverview(trx, await tenantFor(trx, actor, request.params.tenant)),
          ),
        ),
    );

    // The tenant's members (A7.1): names and roles to every member, emails to country and platform admins only.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/members',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!profiles) {
            return reply.code(503).send({ error: 'Member profiles are not configured' });
          }
          const { access, memberships } = await withActor(db, actor, async (trx) => {
            const found = await tenantFor(trx, actor, request.params.tenant);
            return { access: found, memberships: await listMemberships(trx, found.tenantId) };
          });
          const manager = holds(access, 'country_admin');
          const found = await profiles(
            memberships.map((m) => m.userId),
            { emails: manager },
          );
          const members = memberships.map(({ userId, roles }) => ({
            userId,
            name: found.get(userId)?.name ?? null,
            ...(manager ? { email: found.get(userId)?.email ?? null } : {}),
            roles,
          }));
          members.sort(
            (a, b) =>
              (a.name ?? '').localeCompare(b.name ?? '') || a.userId.localeCompare(b.userId),
          );
          return {
            members,
            canManage: manager,
            emailsShown: manager,
            resetReady: passwordLinks !== undefined,
          };
        }),
    );

    // The tenant's invitations (A2), for its country admins and platform admins: RLS shows nobody else any.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/invitations',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              invitations: await listInvitations(trx, access.tenantId),
              canInvite: holds(access, 'country_admin'),
              mailReady: invitations !== undefined,
              days: INVITATION_DAYS,
            };
          }),
        ),
    );

    // Invites someone with a role (A2): stored as the token's hash, then the link goes out by email, on the site's
    // behalf (R115). A pending invitation for the same address and role is revoked once the new one went out; if it
    // can't go out, the new one is revoked instead, and the old one still works.
    scope.post<{ Params: { tenant: string }; Body: { email: string; role: TenantRole } }>(
      '/t/:tenant/invitations',
      {
        schema: {
          params: TENANT_PARAMS,
          body: {
            type: 'object',
            properties: { email: { type: 'string', maxLength: 254 }, role: ROLE },
            required: ['email', 'role'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!invitations) {
            return reply.code(503).send({ error: 'Invitations need the platform email' });
          }
          const email = request.body.email.trim().toLowerCase();
          const { role } = request.body;
          // An address an account could never be made for (Better Auth's rule) gets no invitation.
          if (!INVITABLE_EMAIL.safeParse(email).success) {
            throw new Refusal(400, 'invalid');
          }
          const token = makeInvitationToken();
          const made = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            // Before anything is looked up, so nobody else learns who holds which role.
            if (!holds(access, 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            if (!allowInvitation(actor.userId)) {
              throw new Refusal(429, 'limit');
            }
            const existing = await invitations.accounts.accountId(email);
            if (existing !== undefined && (await holdsRole(trx, access.tenantId, existing, role))) {
              throw new Refusal(409, 'holdsRole');
            }
            const id = await createInvitation(trx, access.tenantId, {
              email,
              role,
              tokenHash: hashInvitationToken(token),
            });
            const overview = await tenantOverview(trx, access);
            return {
              id,
              access,
              name: overview.tenant.name,
              operator: await operatorOf(trx, access.tenantId),
            };
          });
          const locale = isLocale(made.access.defaultLocale)
            ? made.access.defaultLocale
            : LOCALES[0];
          const local = (value: Record<string, string>) =>
            value[locale] ?? Object.values(value)[0] ?? '';
          const inviter = profiles
            ? ((await profiles([actor.userId], { emails: false })).get(actor.userId)?.name ?? '')
            : '';
          try {
            await invitations.send({
              email,
              role,
              locale,
              site: local(made.name) || request.params.tenant,
              operator: made.operator
                ? { name: local(made.operator.name), contactEmail: made.operator.contactEmail }
                : undefined,
              inviter,
              token,
            });
          } catch (error) {
            // Never the address: only that sending failed, and the SMTP code (mailFailure).
            request.log.error({ err: mailFailure(error) }, 'An invitation could not be sent');
            captureException(mailFailure(error));
            await withActor(db, actor, (trx) =>
              revokeInvitation(trx, made.access.tenantId, made.id),
            );
            return reply.code(502).send({ error: 'mailFailed' });
          }
          await withActor(db, actor, (trx) =>
            revokeOthers(trx, made.access.tenantId, { id: made.id, email, role }),
          );
          return reply.code(201).send({ id: made.id });
        }),
    );

    // Revokes a pending invitation (A2.6).
    scope.post<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/invitations/:id/revoke',
      { schema: { params: INVITATION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            if (!(await revokeInvitation(trx, access.tenantId, request.params.id))) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Deletes an accepted, revoked or expired invitation, so its email isn't kept (A2.6); a pending one is revoked first.
    scope.delete<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/invitations/:id',
      { schema: { params: INVITATION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            if (!(await deleteInvitation(trx, access.tenantId, request.params.id))) {
              throw new Refusal(403, 'forbidden');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Gives an existing member another role (A7.2).
    scope.post<{ Params: { tenant: string; userId: string }; Body: { role: TenantRole } }>(
      '/t/:tenant/members/:userId/roles',
      {
        schema: {
          params: MEMBER_PARAMS,
          body: {
            type: 'object',
            properties: { role: ROLE },
            required: ['role'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const result = await addRole(trx, tenantId, request.params.userId, request.body.role);
            if (result === 'not-member') {
              throw new Refusal(409, 'notMember');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Sends a member a password reset email (A7; PLAN R170), for whoever manages the site's members: a link to choose a
    // new password, which the member alone gets, as with "I forgot my password". In the site's language, naming who
    // sent it. At most one every 15 minutes per account.
    scope.post<{ Params: { tenant: string; userId: string } }>(
      '/t/:tenant/members/:userId/password-reset',
      { schema: { params: MEMBER_PARAMS } },
      async (request, reply) =>
        signedIn(
          request,
          reply,
          async (db, actor) => {
            if (!passwordLinks) {
              return reply
                .code(503)
                .send({ error: 'Password reset emails need the platform email' });
            }
            const found = await withActor(db, actor, async (trx) => {
              const access = await tenantFor(trx, actor, request.params.tenant);
              // The database says who manages the members: RLS lets only them lock the tenant's row (lockTenant).
              if (!(await lockTenant(trx, access.tenantId))) {
                throw new Refusal(403, 'forbidden');
              }
              const member = await trx
                .selectFrom('app.memberships')
                .select('user_id')
                .where('tenant_id', '=', access.tenantId)
                .where('user_id', '=', request.params.userId)
                .executeTakeFirst();
              if (!member) {
                throw new Refusal(404, 'notFound');
              }
              return { access, name: (await tenantOverview(trx, access)).tenant.name };
            });
            const locale = isLocale(found.access.defaultLocale)
              ? found.access.defaultLocale
              : LOCALES[0];
            const site =
              found.name[locale] ?? Object.values(found.name)[0] ?? request.params.tenant;
            const manager = profiles
              ? ((await profiles([actor.userId], { emails: false })).get(actor.userId)?.name ?? '')
              : '';
            let result;
            try {
              result = await passwordLinks.send(request.params.userId, {
                name: manager,
                site,
                locale,
              });
            } catch (error) {
              if (!(error instanceof PasswordMailFailed)) {
                throw error;
              }
              // Never the address: only that sending failed, and the SMTP code.
              request.log.error({ err: error }, 'A password reset email could not be sent');
              captureException(error);
              return reply.code(502).send({ error: 'mailFailed' });
            }
            if (result === 'no-account') {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'too-soon') {
              throw new Refusal(429, 'tooSoon');
            }
            if (result === 'not-enrolled') {
              throw new Refusal(409, 'notEnrolled');
            }
            return reply.code(204).send();
          },
          { writes: false },
        ),
    );

    // Removes a role (A7.2), never the tenant's last country admin (A7.4).
    scope.delete<{ Params: { tenant: string; userId: string; role: TenantRole } }>(
      '/t/:tenant/members/:userId/roles/:role',
      { schema: { params: MEMBER_ROLE_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const result = await removeRole(
              trx,
              tenantId,
              request.params.userId,
              request.params.role,
            );
            if (result === 'not-found') {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'forbidden') {
              throw new Refusal(403, 'forbidden');
            }
            if (result === 'last-country-admin') {
              throw new Refusal(409, 'lastCountryAdmin');
            }
          });
          return reply.code(204).send();
        }),
    );

    // A tenant's settings (T1, T3, P1): the report retention, whether live edits need a second approver, and the
    // site's own colours, each set or reset (null) by name.
    scope.patch<{
      Params: { tenant: string };
      Body: {
        reportRetentionDays?: number;
        liveEditsNeedSecondApprover?: boolean;
        theme?: Partial<Record<ThemeColour, string | null>>;
      };
    }>(
      '/t/:tenant/settings',
      {
        schema: {
          params: TENANT_PARAMS,
          body: {
            type: 'object',
            properties: {
              // A century at most: the column takes any positive integer, and a typo shouldn't keep reports forever.
              reportRetentionDays: { type: 'integer', minimum: 1, maximum: 36_500 },
              liveEditsNeedSecondApprover: { type: 'boolean' },
              theme: {
                type: 'object',
                properties: Object.fromEntries(
                  THEME_COLOURS.map((name) => [
                    name,
                    { anyOf: [{ type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' }, { type: 'null' }] },
                  ]),
                ),
                additionalProperties: false,
                minProperties: 1,
              },
            },
            additionalProperties: false,
            minProperties: 1,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            const { reportRetentionDays, liveEditsNeedSecondApprover } = request.body;
            // As the database keeps them, lowercase; and only colours some text reads on at WCAG AA (T1.1).
            // A theme of names the site doesn't use arrives empty too: Fastify drops them.
            if (request.body.theme && Object.keys(request.body.theme).length === 0) {
              throw new Refusal(400, 'invalid');
            }
            const theme = request.body.theme
              ? Object.fromEntries(
                  Object.entries(request.body.theme).map(([name, colour]) => [
                    name,
                    colour?.toLowerCase() ?? null,
                  ]),
                )
              : undefined;
            if (
              Object.entries(theme ?? {}).some(
                ([name, colour]) =>
                  colour !== null && themeColourProblem(name, colour) === 'contrast',
              )
            ) {
              throw new Refusal(422, 'themeContrast');
            }
            // Fastify drops properties the schema doesn't name, so a body of only those arrives empty.
            if (
              reportRetentionDays === undefined &&
              liveEditsNeedSecondApprover === undefined &&
              theme === undefined
            ) {
              throw new Refusal(400, 'invalid');
            }
            refuseUnless(
              await updateSettings(trx, tenantId, {
                reportRetentionDays,
                liveEditsNeedSecondApprover,
                theme,
              }),
            );
          });
          return reply.code(204).send();
        }),
    );

    // The signup list's counts (PLAN R119), for country admins and platform admins only, never an address.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/signups',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            if (!holds(access, 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            return signupCounts(trx, access.tenantId);
          }),
        ),
    );

    // The work queues on the site's dashboard (C1.2): what waits for this member, as RLS shows it to them.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/queues',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) =>
            workQueues(trx, await tenantFor(trx, actor, request.params.tenant), actor.userId),
          ),
        ),
    );

    // The operator's texts (T2): every version, for every member.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/documents',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              documents: await listDocuments(trx, access.tenantId),
              canEdit: holds(access, 'country_admin'),
            };
          }),
        ),
    );

    // Starts a version of a text: a draft, or published at once.
    scope.post<{
      Params: { tenant: string };
      Body: { kind: DocumentKind; body: Record<string, string>; publish?: boolean };
    }>(
      '/t/:tenant/documents',
      {
        schema: {
          params: TENANT_PARAMS,
          body: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: DOCUMENT_KINDS },
              body: localizedSchema(DOCUMENT_MAX_LENGTH),
              publish: { type: 'boolean' },
            },
            required: ['kind', 'body'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const created = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            const result = await createDocument(
              trx,
              access.tenantId,
              request.body.kind,
              publishable(
                requiredLocalized(request.body.body, access),
                access,
                request.body.publish === true,
              ),
              request.body.publish === true,
            );
            if (result === 'draft-exists') {
              throw new Refusal(409, 'draftExists');
            }
            if (result === 'forbidden') {
              throw new Refusal(403, 'forbidden');
            }
            return result;
          });
          return reply.code(201).send(created);
        }),
    );

    // Saves a draft, and publishes it if asked.
    scope.patch<{
      Params: { tenant: string; id: string };
      Body: { body: Record<string, string>; publish?: boolean };
    }>(
      '/t/:tenant/documents/:id',
      {
        schema: {
          params: ID_PARAMS,
          body: {
            type: 'object',
            properties: {
              body: localizedSchema(DOCUMENT_MAX_LENGTH),
              publish: { type: 'boolean' },
            },
            required: ['body'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            refuseUnless(
              await updateDocument(
                trx,
                access.tenantId,
                request.params.id,
                publishable(
                  requiredLocalized(request.body.body, access),
                  access,
                  request.body.publish === true,
                ),
                request.body.publish === true,
              ),
            );
          });
          return reply.code(204).send();
        }),
    );

    // Deletes a draft.
    scope.delete<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/documents/:id',
      { schema: { params: ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { tenantId } = await tenantFor(trx, actor, request.params.tenant);
            refuseUnless(await deleteDocument(trx, tenantId, request.params.id));
          });
          return reply.code(204).send();
        }),
    );

    // Every organization, with the sites each runs or endorses (P2), and the languages a name may be written in.
    scope.get('/organizations', async (request, reply) =>
      signedIn(request, reply, (db, actor) =>
        withActor(db, actor, async (trx) => {
          await platformOnly(trx, actor);
          return {
            organizations: await listOrganizations(trx),
            languages: await platformLanguages(trx),
          };
        }),
      ),
    );

    // A new organization (P2.1).
    scope.post<{ Body: OrganizationBody }>(
      '/organizations',
      { schema: { body: ORGANIZATION_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const id = await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            return createOrganization(
              trx,
              organizationFields(request.body, await platformLanguages(trx)),
            );
          });
          return reply.code(201).send({ id });
        }),
    );

    // One organization, and the languages its name may be in: every site's, and any it already has.
    scope.get<{ Params: { id: string } }>(
      '/organizations/:id',
      { schema: { params: ORGANIZATION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const organization = await getOrganization(trx, request.params.id);
            if (!organization) {
              throw new Refusal(404, 'notFound');
            }
            const languages = [
              ...new Set([
                ...(await platformLanguages(trx)),
                ...Object.keys(organization.displayName),
              ]),
            ].sort();
            return { organization, languages };
          }),
        ),
    );

    // Changes an organization (P2.1): every field at once, as the form shows them.
    scope.put<{ Params: { id: string }; Body: OrganizationBody }>(
      '/organizations/:id',
      { schema: { params: ORGANIZATION_PARAMS, body: ORGANIZATION_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const sites = await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const current = await getOrganization(trx, request.params.id);
            if (!current) {
              throw new Refusal(404, 'notFound');
            }
            const languages = [
              ...(await platformLanguages(trx)),
              ...Object.keys(current.displayName),
            ];
            refuseUnless(
              await updateOrganization(
                trx,
                request.params.id,
                organizationFields(request.body, languages),
              ),
            );
            return sitesOf(trx, request.params.id);
          });
          // Its name and details show on every site it runs or endorses, which no parameter names.
          for (const tenant of sites) {
            tellPublicSite({ tenant });
          }
          return reply.code(204).send();
        }),
    );

    // Every site, with its hostnames (PLAN R129), and the organizations that could run a new one.
    scope.get('/sites', async (request, reply) =>
      signedIn(request, reply, (db, actor) =>
        withActor(db, actor, async (trx) => {
          await platformOnly(trx, actor);
          return {
            sites: await listSites(trx),
            organizations: (await listOrganizations(trx)).map(({ id, displayName, legalName }) => ({
              id,
              displayName,
              legalName,
            })),
          };
        }),
      ),
    );

    // A new site, off until a platform admin turns it on (R129).
    scope.post<{ Body: SiteBody }>(
      '/sites',
      { schema: { body: SITE_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { slug } = await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const fields = siteFields(request.body);
            await createSite(trx, fields);
            return fields;
          });
          return reply.code(201).send({ slug });
        }),
    );

    // One site, with its operator and hostnames.
    scope.get<{ Params: { site: string } }>(
      '/sites/:site',
      { schema: { params: SITE_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const { id: _id, ...site } = await siteFor(trx, request.params.site);
            return { site };
          }),
        ),
    );

    // Turns a site on or off; the database refuses it on without an operator.
    scope.put<{ Params: { site: string }; Body: { active: boolean } }>(
      '/sites/:site/active',
      { schema: { params: SITE_PARAMS, body: SITE_ACTIVE_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const site = await siteFor(trx, request.params.site);
            refuseUnless(
              (await setSiteActive(trx, site.id, request.body.active)) ? 'changed' : 'not-found',
            );
          });
          return reply.code(204).send();
        }),
    );

    // A site's name, its other languages and its operator (admin forms §2, platform; PLAN R195): a platform admin's,
    // as the database insists too. Its main language stays: the public addresses are in its words.
    scope.patch<{
      Params: { site: string };
      Body: { name: Record<string, string>; enabledLocales: string[]; operatorId: string };
    }>(
      '/sites/:site',
      { schema: { params: SITE_PARAMS, body: SITE_DETAILS_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            const site = await siteFor(trx, request.params.site);
            const enabledLocales = [
              ...new Set([site.defaultLocale, ...request.body.enabledLocales]),
            ];
            if (!enabledLocales.every(isLocale)) {
              throw new Refusal(400, 'invalid', undefined, 'enabledLocales');
            }
            const name = localizedInput(request.body.name, enabledLocales);
            if (name === 'invalid') {
              throw new Refusal(400, 'invalid', undefined, 'name');
            }
            if (name === 'empty') {
              throw new Refusal(422, 'incomplete', undefined, 'name');
            }
            refuseUnless(
              (await setSiteDetails(trx, site.id, {
                name,
                enabledLocales,
                operatorId: request.body.operatorId,
              }))
                ? 'changed'
                : 'not-found',
            );
          });
          return reply.code(204).send();
        }),
    );

    // A site's public settings (PLAN R135): open or coming soon, indexed or not, its Plausible script. A platform
    // admin's, as the database insists too.
    const siteSetting = <Body>(
      path: string,
      body: object,
      settings: (body: Body) => SiteSettings,
    ) =>
      scope.put<{ Params: { site: string }; Body: Body }>(
        path,
        { schema: { params: SITE_PARAMS, body } },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              await platformOnly(trx, actor);
              const site = await siteFor(trx, request.params.site);
              refuseUnless(
                // Fastify's types lose the generic body; the schema has checked it is a Body.
                (await setSiteSettings(trx, site.id, settings(request.body as Body)))
                  ? 'changed'
                  : 'not-found',
              );
            });
            return reply.code(204).send();
          }),
      );
    siteSetting<{ open: boolean }>('/sites/:site/open', SITE_OPEN_BODY, ({ open }) => ({
      site_open: open,
    }));
    siteSetting<{ indexed: boolean }>(
      '/sites/:site/indexing',
      SITE_INDEXING_BODY,
      ({ indexed }) => ({
        search_indexing: indexed,
      }),
    );
    siteSetting<{ plausibleScript: string | null }>(
      '/sites/:site/analytics',
      SITE_ANALYTICS_BODY,
      ({ plausibleScript }) => ({ plausible_script: plausibleScript }),
    );

    // The election's cell grid (C1.1).
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/cells',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { access } = await electionFor(trx, actor, request.params);
            const grid = await cellGrid(trx, request.params.tenant, request.params.election);
            if (!grid) {
              throw new Refusal(404, 'notFound');
            }
            return { ...grid, roles: access.roles, platformAdmin: access.platformAdmin };
          }),
        ),
    );

    // One cell, by its party and criterion, with everything its screen shows (C2–C12), and the names of the people
    // its trail names: members RLS shows, never more.
    scope.get<{ Params: { tenant: string; election: string; party: string; criterion: string } }>(
      '/t/:tenant/e/:election/cells/:party/:criterion',
      { schema: { params: CELL_PAIR_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { access, cell, memberIds } = await withActor(db, actor, async (trx) => {
            const found = await electionFor(trx, actor, request.params);
            const pair = await getCell(
              trx,
              found.election.id,
              request.params.party,
              request.params.criterion,
            );
            if (!pair) {
              throw new Refusal(404, 'notFound');
            }
            const memberships = await listMemberships(trx, found.access.tenantId);
            return {
              access: found.access,
              cell: pair,
              memberIds: memberships.map((m) => m.userId),
            };
          });
          // Names only for the site's members RLS shows (ADR-0002 §2, R94); anyone else is named by the admin as such.
          const members = new Set(memberIds);
          const ids = [
            ...(cell.draft
              ? [
                  ...cell.draft.events.map((e) => e.actorId),
                  ...cell.draft.contributors,
                  ...cell.draft.uploaders,
                  ...cell.draft.checkedDocuments.map((c) => c.checkedBy),
                  ...cell.draft.quotes.flatMap((q) =>
                    q.attestedBy === null ? [q.createdBy] : [q.createdBy, q.attestedBy],
                  ),
                ]
              : []),
            // Who contributed to and published each revision (H1.1).
            ...cell.revisions.flatMap((r) =>
              r.internal ? [...r.internal.contributors, r.internal.publisher] : [],
            ),
          ].filter((id) => members.has(id));
          const found = profiles ? await profiles(ids, { emails: false }) : new Map();
          return {
            ...cell,
            names: Object.fromEntries(
              [...new Set(ids)].map((id) => [id, found.get(id)?.name ?? null]),
            ),
            roles: access.roles,
            platformAdmin: access.platformAdmin,
            you: actor.userId,
          };
        }),
    );

    // Creates a cell as a draft (C2.1).
    scope.post<{
      Params: { tenant: string; election: string };
      Body: { partyId: string; criterionId: string };
    }>(
      '/t/:tenant/e/:election/cells',
      {
        schema: {
          params: ELECTION_PARAMS,
          body: {
            type: 'object',
            properties: { partyId: UUID, criterionId: UUID },
            required: ['partyId', 'criterionId'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const id = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return createCell(
              trx,
              access.tenantId,
              election.id,
              request.body.partyId,
              request.body.criterionId,
            );
          });
          return reply.code(201).send({ id });
        }),
    );

    // Saves a draft's rating, summary, change kind, public note and the report it answers (C2, C10, C11), at the version
    // loaded (C14).
    scope.put<{ Params: { tenant: string; election: string; id: string }; Body: CellBody }>(
      '/t/:tenant/e/:election/cells/:id',
      { schema: { params: ELECTION_ID_PARAMS, body: CELL_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const version = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await saveCell(trx, election.id, request.params.id, request.body.version, {
                rating: request.body.rating,
                summary: optionalLocalizedInput(request.body.summary, access),
                changeKind: request.body.changeKind,
                publicNote: optionalLocalizedInput(request.body.publicNote, access),
                reportId: request.body.reportId,
              }),
            );
            // The version it is saved at: what the page sends next, as when it submits right after (R190).
            return cellVersion(trx, request.params.id);
          });
          return reply.code(200).send({ version });
        }),
    );

    // Deletes a cell never published (C13).
    scope.delete<{
      Params: { tenant: string; election: string; id: string };
      Querystring: { version: number };
    }>(
      '/t/:tenant/e/:election/cells/:id',
      { schema: { params: ELECTION_ID_PARAMS, querystring: VERSION_QUERY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await deleteCell(trx, election.id, request.params.id, request.query.version),
            );
          });
          return reply.code(204).send();
        }),
    );

    // Adds a quote (C2.4–7): the database matches it against the source's stored text.
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { version: number; sourceId: string; quote: string; sectionLabel: string | null };
    }>(
      '/t/:tenant/e/:election/cells/:id/quotes',
      {
        schema: {
          params: ELECTION_ID_PARAMS,
          body: {
            type: 'object',
            properties: {
              version: VERSION,
              sourceId: UUID,
              // The column's own bounds (15 to 1,000 characters) are the database's; this only bounds the size.
              quote: { type: 'string', maxLength: 4000 },
              sectionLabel: OPTIONAL_TEXT(200),
            },
            required: ['version', 'sourceId', 'quote', 'sectionLabel'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const version = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await addQuote(
                trx,
                access.tenantId,
                election.id,
                request.params.id,
                request.body.version,
                {
                  sourceId: request.body.sourceId,
                  text: request.body.quote,
                  sectionLabel: optionalText(request.body.sectionLabel),
                },
              ),
            );
            return cellVersion(trx, request.params.id);
          });
          return reply.code(201).send({ version });
        }),
    );

    // Removes a quote.
    scope.delete<{
      Params: { tenant: string; election: string; id: string; quote: string };
      Querystring: { version: number };
    }>(
      '/t/:tenant/e/:election/cells/:id/quotes/:quote',
      { schema: { params: CELL_ITEM_PARAMS('quote'), querystring: VERSION_QUERY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const version = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await removeQuote(
                trx,
                election.id,
                request.params.id,
                request.query.version,
                request.params.quote,
              ),
            );
            return cellVersion(trx, request.params.id);
          });
          return reply.code(200).send({ version });
        }),
    );

    // Where in a video or audio clip a quote is said (C4.1), or none: a change of the quote's content.
    scope.patch<{
      Params: { tenant: string; election: string; id: string; quote: string };
      Body: { version: number; clip: { start: number; end: number | null } | null };
    }>(
      '/t/:tenant/e/:election/cells/:id/quotes/:quote',
      {
        schema: {
          params: CELL_ITEM_PARAMS('quote'),
          body: {
            type: 'object',
            properties: {
              version: VERSION,
              clip: {
                type: ['object', 'null'],
                properties: {
                  start: CLIP_SECONDS,
                  end: { ...CLIP_SECONDS, type: ['number', 'null'] },
                },
                required: ['start', 'end'],
                additionalProperties: false,
              },
            },
            required: ['version', 'clip'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(
          request,
          reply,
          async (db, actor) => {
            const version = await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              const result = await setQuoteClip(
                trx,
                election.id,
                request.params.id,
                request.body.version,
                request.params.quote,
                request.body.clip,
              );
              // Times only for a quote from a video or audio source: they are published with it.
              if (result === 'invalid') {
                throw new Refusal(422, 'invalid');
              }
              refuseUnlessCell(result);
              return cellVersion(trx, request.params.id);
            });
            return reply.code(200).send({ version });
          },
          // A draft's change: nothing the public sees.
          { writes: false },
        ),
    );

    // Attests a quote from a source without text (C4.2), as the version the attester saw: the database records who,
    // and refuses its author and the cell's contributors (PLAN R167) while four-eyes is on.
    scope.post<{
      Params: { tenant: string; election: string; id: string; quote: string };
      Body: { version: number };
    }>(
      '/t/:tenant/e/:election/cells/:id/quotes/:quote/attestation',
      {
        schema: {
          params: CELL_ITEM_PARAMS('quote'),
          body: {
            type: 'object',
            properties: { version: VERSION },
            required: ['version'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(
          request,
          reply,
          async (db, actor) => {
            const version = await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              refuseUnlessCell(
                await attestQuote(
                  trx,
                  election.id,
                  request.params.id,
                  request.body.version,
                  request.params.quote,
                  actor.userId,
                ),
              );
              return cellVersion(trx, request.params.id);
            });
            return reply.code(200).send({ version });
          },
          { writes: false },
        ),
    );

    // Withdraws a quote's attestation (C4.4), so it can be attested again, by someone else.
    scope.delete<{ Params: { tenant: string; election: string; id: string; quote: string } }>(
      '/t/:tenant/e/:election/cells/:id/quotes/:quote/attestation',
      { schema: { params: CELL_ITEM_PARAMS('quote') } },
      async (request, reply) =>
        signedIn(
          request,
          reply,
          async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              refuseUnlessCell(
                await withdrawAttestation(
                  trx,
                  election.id,
                  request.params.id,
                  request.params.quote,
                ),
              );
            });
            return reply.code(204).send();
          },
          { writes: false },
        ),
    );

    // A quote's screenshot or clip (C4), to members: always as a download, never rendered on the admin's origin.
    scope.get<{ Params: { tenant: string; election: string; id: string; quote: string } }>(
      '/t/:tenant/e/:election/cells/:id/quotes/:quote/attestation/file',
      { schema: { params: CELL_ITEM_PARAMS('quote') } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const file = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            return attestationFile(trx, election.id, request.params.id, request.params.quote);
          });
          if (!file) {
            throw new Refusal(404, 'notFound');
          }
          const opened = await files.open(
            { tenantId: file.tenantId, bucket: 'sources' },
            file.sha256,
          );
          if (!opened) {
            throw new Refusal(404, 'notFound');
          }
          return reply
            .header('content-type', file.contentType)
            .header('content-length', String(opened.byteSize))
            .header(
              'content-disposition',
              `attachment; filename="${file.sha256.slice(0, 12)}${ATTESTATION_EXTENSIONS[file.contentType] ?? ''}"`,
            )
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "sandbox; default-src 'none'")
            .header('cache-control', 'private, no-store')
            .send(opened.stream);
        }),
    );

    // Uploads a quote's screenshot or clip (C4.1), as a source's copy is uploaded: who may is checked before a byte is
    // read, the bytes stream to the file store, then the quote names them (a change of its content).
    scope.register(async (attestations) => {
      attestations.addContentTypeParser([...ATTESTATION_TYPES], (_request, payload, done) => {
        done(null, payload);
      });
      limitUnreadBodies(attestations);
      attestations.put<{
        Params: { tenant: string; election: string; id: string; quote: string };
        Querystring: { version: number; filename?: string };
        Body: IncomingMessage;
      }>(
        '/t/:tenant/e/:election/cells/:id/quotes/:quote/attestation/file',
        {
          schema: {
            params: CELL_ITEM_PARAMS('quote'),
            querystring: {
              type: 'object',
              properties: { version: VERSION, filename: { type: 'string', maxLength: 200 } },
              required: ['version'],
            },
          },
        },
        async (request, reply) =>
          signedIn(
            request,
            reply,
            async (db, actor) => {
              if (!files) {
                return reply.code(503).send({ error: 'The file store is not configured' });
              }
              const contentType = (request.headers['content-type'] ?? '')
                .split(';')[0]
                ?.trim()
                .toLowerCase();
              const isAttestationType = (
                type: string | undefined,
              ): type is (typeof ATTESTATION_TYPES)[number] =>
                (ATTESTATION_TYPES as readonly (string | undefined)[]).includes(type);
              if (!isAttestationType(contentType) || typeof request.body?.iterator !== 'function') {
                throw new Refusal(415, 'fileType');
              }
              const access = await withActor(db, actor, async (trx) => {
                const found = await electionFor(trx, actor, request.params);
                // Only someone who may write the draft's quotes gets their bytes stored (the database answers again),
                // and only for a quote that can take them now: everything checkable is checked before a byte is read.
                if (!holds(found.access, 'editor', 'country_admin')) {
                  throw new Refusal(403, 'forbidden');
                }
                const check = await attestationUploadCheck(
                  trx,
                  found.election.id,
                  request.params.id,
                  request.query.version,
                  request.params.quote,
                );
                if (check === 'not-found') {
                  throw new Refusal(404, 'notFound');
                }
                if (check === 'stale') {
                  throw new Refusal(409, 'cellChanged');
                }
                if (check === 'invalid') {
                  throw new Refusal(422, 'invalid');
                }
                if (!allowAttestationFile(actor.userId)) {
                  throw new Refusal(429, 'limit');
                }
                return found.access;
              });
              const declared = Number(request.headers['content-length']);
              if (declared === 0) {
                throw new Refusal(400, 'invalid');
              }
              if (declared > MAX_UPLOAD_BYTES) {
                throw new Refusal(413, 'tooLarge');
              }
              let stored: { sha256: string; byteSize: number };
              try {
                stored = await files.putStream(
                  { tenantId: access.tenantId, bucket: 'sources' },
                  request.body.iterator({ destroyOnReturn: false }),
                  { maxBytes: MAX_UPLOAD_BYTES },
                );
              } catch (error) {
                if (error instanceof TooLargeError) {
                  throw new Refusal(413, 'tooLarge');
                }
                if (error instanceof EmptyError) {
                  throw new Refusal(400, 'invalid');
                }
                if (request.raw.destroyed || request.raw.readableAborted) {
                  throw new Refusal(400, 'invalid');
                }
                throw error;
              }
              const version = await withActor(db, actor, async (trx) => {
                const { election } = await electionFor(trx, actor, request.params);
                const attached = await attachAttestationFile(
                  trx,
                  access.tenantId,
                  election.id,
                  request.params.id,
                  request.query.version,
                  request.params.quote,
                  {
                    ...stored,
                    contentType,
                    filename: fileName(request.query.filename ?? null),
                  },
                );
                if (attached === 'otherType') {
                  throw new Refusal(409, attached);
                }
                if (attached === 'invalid') {
                  throw new Refusal(422, 'invalid');
                }
                refuseUnlessCell(attached);
                return cellVersion(trx, request.params.id);
              });
              return reply.code(201).send({ sha256: stored.sha256, version });
            },
            { writes: false },
          ),
      );
    });

    // Records a checked document for "No lo menciona" (C3).
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { version: number; sourceId: string };
    }>(
      '/t/:tenant/e/:election/cells/:id/checked',
      {
        schema: {
          params: ELECTION_ID_PARAMS,
          body: {
            type: 'object',
            properties: { version: VERSION, sourceId: UUID },
            required: ['version', 'sourceId'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const version = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await addCheckedDocument(
                trx,
                access.tenantId,
                election.id,
                request.params.id,
                request.body.version,
                request.body.sourceId,
              ),
            );
            return cellVersion(trx, request.params.id);
          });
          return reply.code(201).send({ version });
        }),
    );

    // Removes a checked document.
    scope.delete<{
      Params: { tenant: string; election: string; id: string; source: string };
      Querystring: { version: number };
    }>(
      '/t/:tenant/e/:election/cells/:id/checked/:source',
      { schema: { params: CELL_ITEM_PARAMS('source'), querystring: VERSION_QUERY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const version = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await removeCheckedDocument(
                trx,
                election.id,
                request.params.id,
                request.query.version,
                request.params.source,
              ),
            );
            return cellVersion(trx, request.params.id);
          });
          return reply.code(200).send({ version });
        }),
    );

    // Submits a draft (C5), recalls it (C6) or publishes the version the reviewer saw (C7).
    for (const step of ['submit', 'recall', 'publish'] as const) {
      scope.post<{
        Params: { tenant: string; election: string; id: string };
        Body: { version: number };
      }>(
        `/t/:tenant/e/:election/cells/:id/${step}`,
        {
          schema: {
            params: ELECTION_ID_PARAMS,
            body: {
              type: 'object',
              properties: { version: VERSION },
              required: ['version'],
              additionalProperties: false,
            },
          },
        },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              const { id } = request.params;
              const { version } = request.body;
              refuseUnlessCell(
                step === 'publish'
                  ? await publishCell(trx, election.id, id, version)
                  : await moveCell(
                      trx,
                      election.id,
                      id,
                      version,
                      step === 'submit' ? 'in_review' : 'draft',
                    ),
              );
            });
            return reply.code(204).send();
          }),
      );
    }

    // Sends a cell in review back with a note (C8).
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { version: number; note: string };
    }>(
      '/t/:tenant/e/:election/cells/:id/reject',
      { schema: { params: ELECTION_ID_PARAMS, body: NOTE_BODY(true) } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await rejectCell(
                trx,
                access.tenantId,
                election.id,
                request.params.id,
                request.body.version,
                requiredNote(request.body.note),
              ),
            );
          });
          return reply.code(204).send();
        }),
    );

    // Comments on a cell (C9).
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { note: string };
    }>(
      '/t/:tenant/e/:election/cells/:id/comments',
      { schema: { params: ELECTION_ID_PARAMS, body: NOTE_BODY(false) } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await commentOnCell(
                trx,
                access.tenantId,
                election.id,
                request.params.id,
                requiredNote(request.body.note),
              ),
            );
          });
          return reply.code(201).send();
        }),
    );

    // Clears a recheck flag (C12.2).
    scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/cells/:id/recheck',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(await clearRecheck(trx, election.id, request.params.id));
          });
          return reply.code(204).send();
        }),
    );

    // The live match of a quote against a source (C2.6, W13): what the database will decide on save, as the editor
    // pauses typing. Each member may ask 120 times a minute; a source's normalised text is kept for the next ask.
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { quote: string };
    }>(
      '/t/:tenant/e/:election/sources/:id/match',
      {
        schema: {
          params: ELECTION_ID_PARAMS,
          body: {
            type: 'object',
            properties: { quote: { type: 'string', maxLength: 4000 } },
            required: ['quote'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(
          request,
          reply,
          (db, actor) =>
            (async () => {
              if (!allowMatch(actor.userId)) {
                return reply.code(429).send({ error: 'limit' });
              }
              const sourceId = request.params.id;
              // Read and checked under RLS every time; the prepared text is kept only once extraction is over.
              const prepared = await withActor(db, actor, async (trx) => {
                const { election } = await electionFor(trx, actor, request.params);
                const kept = preparedSources.get(sourceId);
                if (kept && (await sourceVisible(trx, election.id, sourceId))) {
                  return kept;
                }
                const found = await sourceUnits(trx, election.id, sourceId);
                if (!found) {
                  throw new Refusal(404, 'notFound');
                }
                const ready = prepareSource(found.units);
                if (found.final) {
                  keepPrepared(sourceId, ready);
                }
                return ready;
              });
              // Outside the transaction: matching is CPU work that needs no connection.
              return matchPrepared(request.body.quote, prepared);
            })(),
          // A POST for its body's size, but it saves nothing: the public site isn't told at every pause in typing.
          { writes: false },
        ),
    );

    // The election's sources (S1–S6), with the parties they may belong to. Its open extraction jobs, read as the
    // member, go to the dispatch once the read is over: one waiting too long is handed over again (ADR-0006).
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/sources',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { answer, open, archiving } = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return {
              answer: {
                sources: await listSources(trx, election.id),
                canEdit: holds(access, 'editor', 'country_admin'),
                uploads: files !== undefined,
                extraction: extraction !== undefined,
                fetching: files !== undefined && fetcher !== undefined,
                archiving: archives !== undefined,
              },
              open: extraction ? await openExtractions(trx, election.id) : [],
              archiving: archives ? await openArchives(trx, election.id) : [],
            };
          });
          extraction?.waiting(open);
          archives?.waiting(archiving);
          return answer;
        }),
    );

    // One source (S6), with its extracted text by page or section: members only, never public (S6.2).
    scope.get<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { answer, open, archiving } = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            const [source] = await listSources(trx, election.id, request.params.id);
            const text = await sourceUnits(trx, election.id, request.params.id);
            if (!source || !text) {
              throw new Refusal(404, 'notFound');
            }
            return {
              answer: {
                source,
                units: text.units,
                canEdit: holds(access, 'editor', 'country_admin'),
                uploads: files !== undefined,
                extraction: extraction !== undefined,
                fetching: files !== undefined && fetcher !== undefined,
                archiving: archives !== undefined,
              },
              // Its open jobs, as on the list: the page an editor reloads while its text is being extracted.
              open: extraction ? await openExtractions(trx, election.id, request.params.id) : [],
              archiving: archives ? await openArchives(trx, election.id, request.params.id) : [],
            };
          });
          extraction?.waiting(open);
          archives?.waiting(archiving);
          return answer;
        }),
    );

    // A new source (S1.1).
    scope.post<{ Params: { tenant: string; election: string }; Body: SourceBody }>(
      '/t/:tenant/e/:election/sources',
      { schema: { params: ELECTION_PARAMS, body: SOURCE_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const id = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return createSource(trx, access.tenantId, election.id, sourceFields(request.body));
          });
          return reply.code(201).send({ id });
        }),
    );

    // Changes a source's fields, until it has a stored copy (S1.2).
    scope.put<{ Params: { tenant: string; election: string; id: string }; Body: SourceBody }>(
      '/t/:tenant/e/:election/sources/:id',
      { schema: { params: ELECTION_ID_PARAMS, body: SOURCE_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            if (
              !(await updateSource(trx, election.id, request.params.id, sourceFields(request.body)))
            ) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Marks a source replaced by a newer version (PLAN D14, R172): for those who write sources (RLS), once.
    scope.post<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id/replaced',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            const result = await markReplaced(trx, election.id, request.params.id);
            if (result === 'not-found') {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'replaced') {
              throw new Refusal(409, 'stale');
            }
            if (result === 'forbidden') {
              throw new Refusal(403, 'forbidden');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Deletes a source nothing cites (S5.2).
    scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            if (!(await deleteSource(trx, election.id, request.params.id))) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Uploads a source's copy (S2.2). Who may store it, and whether the source can still take one, are checked before
    // a byte of the body is read (it waits on the connection meanwhile); then the bytes stream to the file store,
    // hashed on the way and never held in memory, up to the limit. Then the source names them and extraction is
    // requested (S3.1), which the worker is then asked to do.
    scope.register(async (uploads) => {
      uploads.addContentTypeParser([...UPLOAD_TYPES], (_request, payload, done) => {
        done(null, payload);
      });
      // A refused upload's unread rest is dropped within limits, then its connection closed.
      limitUnreadBodies(uploads);
      uploads.put<{
        Params: { tenant: string; election: string; id: string };
        Querystring: { filename?: string };
        Body: IncomingMessage;
      }>(
        '/t/:tenant/e/:election/sources/:id/copy',
        {
          schema: {
            params: ELECTION_ID_PARAMS,
            querystring: {
              type: 'object',
              properties: { filename: { type: 'string', maxLength: 200 } },
            },
          },
        },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            if (!files) {
              return reply.code(503).send({ error: 'The file store is not configured' });
            }
            // As Fastify matched it, lowercase: what the files table's check takes. Anything else (JSON, which the
            // scope's own parser reads, or no body at all) is no copy.
            const contentType = (request.headers['content-type'] ?? '')
              .split(';')[0]
              ?.trim()
              .toLowerCase();
            if (!isUploadType(contentType) || typeof request.body?.iterator !== 'function') {
              throw new Refusal(415, 'fileType');
            }
            const access = await withActor(db, actor, async (trx) => {
              const found = await electionFor(trx, actor, request.params);
              // Only someone who may write the election's sources gets their bytes stored (RLS answers again below).
              if (!holds(found.access, 'editor', 'country_admin')) {
                throw new Refusal(403, 'forbidden');
              }
              const source = await sourceForUpload(trx, found.election.id, request.params.id);
              if (!source) {
                throw new Refusal(404, 'notFound');
              }
              // A stored copy never changes (S1.2): a second one is refused before it is read.
              if (source.hasCopy) {
                throw new Refusal(409, 'hasCopy');
              }
              return found.access;
            });
            const declared = Number(request.headers['content-length']);
            if (declared === 0) {
              throw new Refusal(400, 'invalid');
            }
            if (declared > MAX_UPLOAD_BYTES) {
              throw new Refusal(413, 'tooLarge');
            }
            let stored: { sha256: string; byteSize: number };
            try {
              stored = await files.putStream(
                { tenantId: access.tenantId, bucket: 'sources' },
                // Stopping early (too large) leaves the connection open for the refusal.
                request.body.iterator({ destroyOnReturn: false }),
                { maxBytes: MAX_UPLOAD_BYTES },
              );
            } catch (error) {
              if (error instanceof TooLargeError) {
                throw new Refusal(413, 'tooLarge');
              }
              if (error instanceof EmptyError) {
                throw new Refusal(400, 'invalid');
              }
              // The browser went away mid-upload: nothing was kept, and nobody is there to tell.
              if (request.raw.destroyed || request.raw.readableAborted) {
                throw new Refusal(400, 'invalid');
              }
              throw error;
            }
            const job = await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              const attached = await attachUpload(
                trx,
                access.tenantId,
                election.id,
                request.params.id,
                {
                  ...stored,
                  contentType,
                  filename: fileName(request.query.filename ?? null),
                },
                { archive: archives !== undefined },
              );
              if (attached === 'notFound') {
                throw new Refusal(404, attached);
              }
              if (attached === 'hasCopy' || attached === 'otherType') {
                throw new Refusal(409, attached);
              }
              // Only a fetched copy names its URL.
              if (attached === 'urlChanged') {
                throw new Refusal(409, 'stale');
              }
              return attached;
            });
            extraction?.dispatch({
              jobId: job.jobId,
              tenantId: access.tenantId,
              sha256: stored.sha256,
              contentType,
            });
            if (job.archive) {
              archives?.dispatch(job.archive);
            }
            return reply.code(201).send({ sha256: stored.sha256 });
          }),
      );
    });

    // Asks the worker again to extract a source whose job is still waiting (S3), e.g. after the worker was away: for
    // those who may write sources, a few times a minute. The worker takes a job it already has only once.
    scope.post<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id/extract',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!extraction) {
            return reply.code(503).send({ error: 'Extraction is not configured' });
          }
          if (!allowExtraction(actor.userId)) {
            throw new Refusal(429, 'limit');
          }
          const pending = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            if (!holds(access, 'editor', 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            return pendingExtraction(trx, election.id, request.params.id);
          });
          if (!pending) {
            throw new Refusal(404, 'notFound');
          }
          extraction.dispatch(pending);
          return reply.code(202).send();
        }),
    );

    // Stores a source's copy from its URL (S2.1; ADR-0007 §3): the fetcher fetches it, never the API, and its bytes are
    // stored exactly as an upload's, in the requester's name, so four-eyes counts them as a contributor of every cell
    // that cites it (D17). Who may, and whether the source can take a copy, are checked first, as for an upload; a
    // site's refusal, error or silence is the member's to hear. Then extraction and a snapshot, as after an upload.
    scope.post<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id/fetch',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files || !fetcher) {
            return reply.code(503).send({ error: 'Fetching is not configured' });
          }
          if (!allowFetch(actor.userId)) {
            throw new Refusal(429, 'limit');
          }
          const { access, url } = await withActor(db, actor, async (trx) => {
            const found = await electionFor(trx, actor, request.params);
            if (!holds(found.access, 'editor', 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            const source = await sourceForUpload(trx, found.election.id, request.params.id);
            if (!source) {
              throw new Refusal(404, 'notFound');
            }
            if (source.hasCopy) {
              throw new Refusal(409, 'hasCopy');
            }
            if (!source.url) {
              throw new Refusal(409, 'noUrl');
            }
            return { access: found.access, url: source.url };
          });
          const fetched = await fetcher.fetchCopy(url);
          if ('problem' in fetched) {
            switch (fetched.problem) {
              case 'refused':
                throw new Refusal(422, 'fetchRefused');
              case 'failed':
                throw new Refusal(422, 'fetchFailed');
              case 'tooLarge':
                throw new Refusal(413, 'tooLarge');
              case 'fileType':
                throw new Refusal(415, 'fileType');
              default:
                // The fetcher itself: busy, away, or not answering in time.
                return reply.code(503).send({ error: 'fetchUnavailable' });
            }
          }
          const { contentType } = fetched;
          if (!isUploadType(contentType)) {
            // The fetcher refuses these itself; should one come anyway, its bytes are left unread.
            fetched.body.destroy();
            throw new Refusal(415, 'fileType');
          }
          let stored: { sha256: string; byteSize: number };
          try {
            stored = await files.putStream(
              { tenantId: access.tenantId, bucket: 'sources' },
              fetched.body,
              { maxBytes: MAX_UPLOAD_BYTES },
            );
          } catch (error) {
            if (error instanceof TooLargeError) {
              throw new Refusal(413, 'tooLarge');
            }
            // Nothing, or bytes cut off on their way from the fetcher: nothing was kept.
            throw new Refusal(422, 'fetchFailed');
          }
          const job = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            const attached = await attachUpload(
              trx,
              access.tenantId,
              election.id,
              request.params.id,
              { ...stored, contentType, filename: fetchedFilename(fetched.finalUrl) },
              // Still the URL that was fetched: an edit meanwhile would leave a copy of another address.
              { archive: archives !== undefined, url },
            );
            if (attached === 'notFound') {
              throw new Refusal(404, attached);
            }
            if (attached === 'urlChanged') {
              throw new Refusal(409, 'stale');
            }
            if (attached === 'hasCopy' || attached === 'otherType') {
              throw new Refusal(409, attached);
            }
            return attached;
          });
          extraction?.dispatch({
            jobId: job.jobId,
            tenantId: access.tenantId,
            sha256: stored.sha256,
            contentType,
          });
          if (job.archive) {
            archives?.dispatch(job.archive);
          }
          return reply.code(201).send({ sha256: stored.sha256 });
        }),
    );

    // Asks for a snapshot of a source's URL (S4; ADR-0007 §4), or for the one already asked for again: for those who
    // may write sources. The archive job is the requester's; the fetcher asks the archive, the worker records it.
    scope.post<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id/archive',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!archives) {
            return reply.code(503).send({ error: 'Archiving is not configured' });
          }
          if (!allowArchive(actor.userId)) {
            throw new Refusal(429, 'limit');
          }
          const job = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            if (!holds(access, 'editor', 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            const [source] = await listSources(trx, election.id, request.params.id);
            if (!source) {
              throw new Refusal(404, 'notFound');
            }
            if (!source.url) {
              throw new Refusal(409, 'noUrl');
            }
            // Until its copy is stored its URL can change: the snapshot is taken with the copy.
            if (!source.copy) {
              throw new Refusal(409, 'noCopy');
            }
            if (source.archiveUrl) {
              throw new Refusal(409, 'hasArchive');
            }
            return requestArchive(trx, access.tenantId, source.id);
          });
          if (job) {
            archives.dispatch(job);
          }
          return reply.code(202).send();
        }),
    );

    // A source's stored copy (S6), to members: always as a download, never rendered on the admin's origin, since its
    // bytes are a party's, not ours (an HTML page could carry script).
    scope.get<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/sources/:id/copy',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const copy = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            return sourceCopy(trx, election.id, request.params.id);
          });
          if (!copy) {
            throw new Refusal(404, 'notFound');
          }
          // Streamed from the store, never held in memory; checked against its hash as it goes, so a damaged copy
          // ends short of its length rather than arriving whole and wrong.
          const opened = await files.open(
            { tenantId: copy.tenantId, bucket: 'sources' },
            copy.sha256,
          );
          if (!opened) {
            throw new Refusal(404, 'notFound');
          }
          return reply
            .header('content-type', copy.contentType)
            .header('content-length', String(opened.byteSize))
            .header('content-disposition', `attachment; filename="${copy.sha256.slice(0, 12)}"`)
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "sandbox; default-src 'none'")
            .header('cache-control', 'private, no-store')
            .send(opened.stream);
        }),
    );

    // The tenant's elections (§6).
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/elections',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              elections: await listElections(trx, access.tenantId),
              canCreate: holds(access, 'country_admin', 'editor'),
            };
          }),
        ),
    );

    // Creates an election (E1.1): always a draft.
    scope.post<{ Params: { tenant: string }; Body: ElectionBody }>(
      '/t/:tenant/elections',
      {
        schema: {
          params: TENANT_PARAMS,
          body: { ...ELECTION_BODY, required: ['slug', 'type', 'name'] },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const created = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            const { slug, type, name } = request.body;
            if (slug === undefined || type === undefined || name === undefined) {
              throw new Refusal(400, 'invalid');
            }
            return createElection(trx, access.tenantId, {
              slug,
              type,
              territoryCode: request.body.territoryCode ?? null,
              name: requiredLocalized(name, access),
              date: request.body.date ?? null,
            });
          });
          return reply.code(201).send({ slug: created.slug });
        }),
    );

    // An election's overview (§13.6).
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return { election, ...capabilities(access) };
          }),
        ),
    );

    // Changes an election's fields, announcement or four-eyes (E1.3, P1).
    scope.patch<{ Params: { tenant: string; election: string }; Body: ElectionBody }>(
      '/t/:tenant/e/:election',
      { schema: { params: ELECTION_PARAMS, body: { ...ELECTION_BODY, minProperties: 1 } } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const slug = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            // The fields, the announcement, four-eyes, the status and the freeze window, each as the database allows.
            // Fastify drops properties the schema doesn't name, so a body of only those arrives empty.
            if (Object.keys(request.body).length === 0) {
              throw new Refusal(400, 'invalid');
            }
            const { name, territoryCode, ...rest } = request.body;
            refuseUnless(
              await updateElection(trx, access.tenantId, election.id, {
                ...rest,
                ...(territoryCode === undefined ? {} : { territoryCode }),
                ...(name === undefined ? {} : { name: requiredLocalized(name, access) }),
              }),
            );
            return request.body.slug ?? election.slug;
          });
          return { slug };
        }),
    );

    // What going live needs, and what it only warns about (E5.2, E5.3).
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/checklist',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return goLiveChecklist(trx, access, election.id);
          }),
        ),
    );

    // The published "not mentioned" ratings that rest only on replaced documents (D20, PLAN R187): a warning for any
    // member, never a refusal.
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/rechecks',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            return { rechecks: await listRechecks(trx, election.id) };
          }),
        ),
    );

    // Deletes a draft election (E8).
    scope.delete<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnless(await deleteElection(trx, access.tenantId, election.id));
          });
          return reply.code(204).send();
        }),
    );

    // Deletes an election for good, whatever its status (PLAN R212): platform admins, who type its short name.
    scope.post<{ Params: { tenant: string; election: string }; Body: { confirmation: string } }>(
      '/t/:tenant/e/:election/purge',
      {
        schema: {
          params: ELECTION_PARAMS,
          body: {
            type: 'object',
            properties: { confirmation: { type: 'string', maxLength: 100 } },
            required: ['confirmation'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            await purgeElection(trx, access.tenantId, election.id, request.body.confirmation);
          });
          return reply.code(204).send();
        }),
    );

    // An election's methodology and its named external reviewers (E2, E3), with what a demands methodology may name.
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/methodology',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            return {
              methodology: await getMethodology(trx, election.id),
              demandsOwners: await listDemandsOwners(trx, access.tenantId),
              kind: access.methodologyKind,
              canEdit: holds(access, 'country_admin'),
            };
          }),
        ),
    );

    // Writes the methodology: created the first time, changed afterwards.
    scope.put<{ Params: { tenant: string; election: string }; Body: MethodologyBody }>(
      '/t/:tenant/e/:election/methodology',
      { schema: { params: ELECTION_PARAMS, body: METHODOLOGY_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnless(
              await saveMethodology(
                trx,
                { id: access.tenantId, methodologyKind: access.methodologyKind },
                election.id,
                {
                  demandsOwnerId: request.body.demandsOwnerId,
                  body: requiredLocalized(request.body.body, access),
                  admissibleSourceKinds: request.body.admissibleSourceKinds,
                  notMentionedSourceKinds: request.body.notMentionedSourceKinds,
                },
              ),
            );
          });
          return reply.code(204).send();
        }),
    );

    scope.delete<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/methodology',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnless(await deleteMethodology(trx, election.id));
          });
          return reply.code(204).send();
        }),
    );

    scope.post<{ Params: { tenant: string; election: string }; Body: ReviewerBody }>(
      '/t/:tenant/e/:election/methodology/reviewers',
      { schema: { params: ELECTION_PARAMS, body: REVIEWER_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const created = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            const methodologyId = await methodologyIdOf(trx, election.id);
            if (!methodologyId) {
              throw new Refusal(409, 'noMethodology');
            }
            return addReviewer(trx, access.tenantId, methodologyId, reviewerFields(request.body));
          });
          return reply.code(201).send(created);
        }),
    );

    scope.patch<{ Params: { tenant: string; election: string; id: string }; Body: ReviewerBody }>(
      '/t/:tenant/e/:election/methodology/reviewers/:id',
      { schema: { params: ELECTION_ID_PARAMS, body: REVIEWER_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            const methodologyId = await methodologyIdOf(trx, election.id);
            refuseUnless(
              methodologyId
                ? await updateReviewer(
                    trx,
                    methodologyId,
                    request.params.id,
                    reviewerFields(request.body),
                  )
                : 'not-found',
            );
          });
          return reply.code(204).send();
        }),
    );

    scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/methodology/reviewers/:id',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            const methodologyId = await methodologyIdOf(trx, election.id);
            refuseUnless(
              methodologyId
                ? await deleteReviewer(trx, methodologyId, request.params.id)
                : 'not-found',
            );
          });
          return reply.code(204).send();
        }),
    );

    // A party's programme status (PS1): a check, even to the same status, stamps its date; live elections included.
    scope.put<{
      Params: { tenant: string; election: string; id: string };
      Body: { status: 'pending' | 'published' };
    }>(
      '/t/:tenant/e/:election/parties/:id/programme',
      {
        schema: {
          params: ELECTION_ID_PARAMS,
          body: {
            type: 'object',
            properties: { status: { type: 'string', enum: ['pending', 'published'] } },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            refuseUnless(
              await setProgrammeStatus(trx, election.id, request.params.id, request.body.status),
            );
          });
          return reply.code(204).send();
        }),
    );

    // A party's logo (E4; PLAN R142), to members: the image itself, never as anything but its own type.
    scope.get<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/parties/:id/logo',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const logo = await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            return partyLogoFile(trx, election.id, request.params.id);
          });
          const opened =
            logo &&
            (await files.open({ tenantId: logo.tenantId, bucket: 'public_assets' }, logo.sha256));
          if (!logo || !opened) {
            throw new Refusal(404, 'notFound');
          }
          return reply
            .header('content-type', logo.contentType)
            .header('content-length', String(opened.byteSize))
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "sandbox; default-src 'none'")
            .header('cache-control', 'private, max-age=300')
            .send(opened.stream);
        }),
    );

    // Uploads a party's logo while its election is a draft or in preview (once live, through a change request, CR1:
    // the next route). Who may, and whether the party can take one now, are checked before the body is read; the image
    // must be what its type says, by its own header, within the limits. Then the bytes go to the site's public assets,
    // where the public site serves them once the election is live.
    scope.register(async (logos) => {
      logos.addContentTypeParser([...LOGO_TYPES], (_request, payload, done) => {
        done(null, payload);
      });
      limitUnreadBodies(logos);
      type LogoRequest = FastifyRequest<{
        Params: { tenant: string; election: string; id: string };
        Querystring: { filename?: string };
        Body: IncomingMessage;
      }>;
      const LOGO_ROUTE = {
        schema: {
          params: ELECTION_ID_PARAMS,
          querystring: {
            type: 'object',
            properties: { filename: { type: 'string', maxLength: 200 } },
          },
        },
      } as const;
      /**
       * A logo from the request, for a party of the election that `takesOne` says may take one now: its type, the
       * user's rate, their role and the party are checked before the body is read, and the image, read whole, before
       * anything is stored. Then its bytes are in the site's public assets, which nothing names yet.
       */
      const receiveLogo = async (
        request: LogoRequest,
        db: Database,
        actor: Actor,
        store: FileStore,
        takesOne: (status: ElectionStatus) => boolean,
      ): Promise<{ access: Access; upload: LogoUpload }> => {
        const contentType = logoTypeOf(request);
        if (!contentType || typeof request.body?.iterator !== 'function') {
          throw new Refusal(415, 'logoImage');
        }
        if (!allowLogo(actor.userId)) {
          throw new Refusal(429, 'limit');
        }
        const access = await withActor(db, actor, async (trx) => {
          const found = await electionFor(trx, actor, request.params);
          if (!holds(found.access, 'editor', 'country_admin')) {
            throw new Refusal(403, 'forbidden');
          }
          if (!takesOne(found.election.status)) {
            throw new Refusal(409, 'changeControlled');
          }
          const party = await partyForLogo(trx, found.election.id, request.params.id);
          if (!party || party.retired) {
            throw new Refusal(404, 'notFound');
          }
          return found.access;
        });
        const bytes = await readImage(request, contentType);
        const sha256 = await store.put(
          { tenantId: access.tenantId, bucket: 'public_assets' },
          bytes,
        );
        return {
          access,
          upload: {
            sha256,
            byteSize: bytes.byteLength,
            contentType,
            filename: fileName(request.query.filename ?? null),
          },
        };
      };

      logos.put<{
        Params: { tenant: string; election: string; id: string };
        Querystring: { filename?: string };
        Body: IncomingMessage;
      }>('/t/:tenant/e/:election/parties/:id/logo', LOGO_ROUTE, async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const { access, upload } = await receiveLogo(request, db, actor, files, editedDirectly);
          await withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            const result = await setPartyLogo(
              trx,
              access.tenantId,
              election.id,
              request.params.id,
              upload,
            );
            if (result === 'notFound') {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'otherType') {
              throw new Refusal(409, 'otherType');
            }
          });
          return reply.code(201).send({ sha256: upload.sha256 });
        }),
      );

      // A live party's next logo (PLAN R183), for a change request to propose: stored in the site's public assets as
      // the draft's are, and named by nothing until a request naming it is approved (the database takes a logo only
      // from those assets, and the public sees one only once a party names it). Its file's id.
      logos.put<{
        Params: { tenant: string; election: string; id: string };
        Querystring: { filename?: string };
        Body: IncomingMessage;
      }>('/t/:tenant/e/:election/parties/:id/proposed-logo', LOGO_ROUTE, async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const { access, upload } = await receiveLogo(
            request,
            db,
            actor,
            files,
            (status) => status === 'live',
          );
          const fileId = await withActor(db, actor, (trx) =>
            storeLogoFile(trx, access.tenantId, upload),
          );
          if (!fileId) {
            throw new Refusal(409, 'otherType');
          }
          return reply.code(201).send({ fileId, sha256: upload.sha256 });
        }),
      );

      // A site's brand image, slot by slot (admin forms §2, settings; PLAN R195): its country admins' and platform
      // admins', checked with the type and the user's rate before the body is read; the image checked as a party's
      // logo is, then stored in the site's public assets and selected, which the public site serves at once.
      logos.put<{
        Params: { tenant: string; slot: string };
        Querystring: { filename?: string };
        Body: IncomingMessage;
      }>(
        '/t/:tenant/brand/:slot',
        { schema: { params: BRAND_PARAMS, querystring: FILENAME_QUERY } },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            if (!files) {
              return reply.code(503).send({ error: 'The file store is not configured' });
            }
            const contentType = logoTypeOf(request);
            if (!contentType) {
              throw new Refusal(415, 'logoImage');
            }
            if (!allowLogo(actor.userId)) {
              throw new Refusal(429, 'limit');
            }
            const access = await withActor(db, actor, async (trx) => {
              const found = await tenantFor(trx, actor, request.params.tenant);
              if (!holds(found, 'country_admin')) {
                throw new Refusal(403, 'forbidden');
              }
              return found;
            });
            const bytes = await readImage(request, contentType);
            // A site's icon is what browsers and phones take for one: a square PNG, 512 to 1,024 px a side (T1.4).
            if (request.params.slot === BRAND_SLOTS.siteIcon) {
              const sides = imageSize(bytes);
              if (
                contentType !== 'image/png' ||
                !sides ||
                sides.width !== sides.height ||
                sides.width < 512 ||
                sides.width > 1024
              ) {
                throw new Refusal(422, 'siteIcon');
              }
            }
            const sha256 = await files.put(
              { tenantId: access.tenantId, bucket: 'public_assets' },
              bytes,
            );
            await withActor(db, actor, async (trx) => {
              const result = await setBrandImage(trx, access.tenantId, request.params.slot, {
                sha256,
                byteSize: bytes.byteLength,
                contentType,
                filename: fileName(request.query.filename ?? null),
              });
              if (result === 'otherType') {
                throw new Refusal(409, 'otherType');
              }
            });
            return reply.code(201).send({ sha256 });
          }),
      );

      // An organization's logo (admin forms §2, platform; PLAN R195): a platform admin's, one of the platform's images,
      // its bytes in the platform's space. The organization is found before the body is read.
      logos.put<{ Params: { id: string }; Body: IncomingMessage }>(
        '/organizations/:id/logo',
        { schema: { params: ORGANIZATION_PARAMS } },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            if (!files) {
              return reply.code(503).send({ error: 'The file store is not configured' });
            }
            const organization = await withActor(db, actor, async (trx) => {
              await platformOnly(trx, actor);
              const found = await getOrganization(trx, request.params.id);
              if (!found) {
                throw new Refusal(404, 'notFound');
              }
              return found;
            });
            const contentType = logoTypeOf(request);
            if (!contentType) {
              throw new Refusal(415, 'logoImage');
            }
            if (!allowLogo(actor.userId)) {
              throw new Refusal(429, 'limit');
            }
            const bytes = await readImage(request, contentType);
            const sha256 = await files.put('platform', bytes);
            let sites: string[];
            try {
              sites = await withActor(db, actor, async (trx) => {
                refuseUnlessLogo(
                  await setOrganizationLogo(trx, request.params.id, {
                    sha256,
                    byteSize: bytes.byteLength,
                    contentType,
                    // Neutral: every site's members see the catalogue's names (PLAN R195).
                    name: `organization-logo-${organization.id}`,
                  }),
                );
                return sitesOf(trx, request.params.id);
              });
            } catch (error) {
              // The database's word, at commit, that these bytes are a restricted image and the organization no
              // PauseAI chapter (`restricted_assets_are_eligible`), or are stored restricted already, by an owner's
              // script in the meantime (`brand_asset_restriction_is_one`): said as such.
              if (!(error instanceof Refusal) && databaseRefusal(error).error === 'incomplete') {
                throw new Refusal(422, 'restrictedAsset');
              }
              throw error;
            }
            for (const tenant of sites) {
              tellPublicSite({ tenant });
            }
            return reply.code(201).send({ sha256 });
          }),
      );
    });

    // A site's brand images, slot by slot, to every member (PLAN R195); and whether this member may change them.
    scope.get<{ Params: { tenant: string } }>(
      '/t/:tenant/brand',
      { schema: { params: TENANT_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              slots: await listBrand(trx, access.tenantId),
              canEdit: holds(access, 'country_admin'),
            };
          }),
        ),
    );

    // Empties a slot of the site's brand images: its country admins' and platform admins'.
    scope.delete<{ Params: { tenant: string; slot: string } }>(
      '/t/:tenant/brand/:slot',
      { schema: { params: BRAND_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            if (!holds(access, 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            if (
              (await setBrandImage(trx, access.tenantId, request.params.slot, null)) ===
              'platformImage'
            ) {
              throw new Refusal(403, 'forbidden');
            }
          });
          return reply.code(204).send();
        }),
    );

    // An organization's logo, to platform admins: the image itself, never as anything but its own type.
    scope.get<{ Params: { id: string } }>(
      '/organizations/:id/logo',
      { schema: { params: ORGANIZATION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const logo = await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            return organizationLogo(trx, request.params.id);
          });
          const opened =
            logo &&
            (LOGO_TYPES as readonly string[]).includes(logo.contentType) &&
            (await files.open('platform', logo.sha256));
          if (!logo || !opened) {
            throw new Refusal(404, 'notFound');
          }
          return reply
            .header('content-type', logo.contentType)
            .header('content-length', String(opened.byteSize))
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "sandbox; default-src 'none'")
            .header('cache-control', 'private, max-age=300')
            .send(opened.stream);
        }),
    );

    // Removes an organization's logo; the image stays among the platform's.
    scope.delete<{ Params: { id: string } }>(
      '/organizations/:id/logo',
      { schema: { params: ORGANIZATION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const sites = await withActor(db, actor, async (trx) => {
            await platformOnly(trx, actor);
            refuseUnlessLogo(await setOrganizationLogo(trx, request.params.id, null));
            return sitesOf(trx, request.params.id);
          });
          for (const tenant of sites) {
            tellPublicSite({ tenant });
          }
          return reply.code(204).send();
        }),
    );

    // One of the site's public images by its file's id (a logo a change request proposes or replaced, PLAN R183), to
    // members: the image itself, never as anything but its own type, as a party's logo is shown.
    scope.get<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/images/:id',
      { schema: { params: ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          if (!files) {
            return reply.code(503).send({ error: 'The file store is not configured' });
          }
          const image = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return publicImageFile(trx, access.tenantId, request.params.id);
          });
          const opened =
            image &&
            (LOGO_TYPES as readonly string[]).includes(image.contentType) &&
            (await files.open({ tenantId: image.tenantId, bucket: 'public_assets' }, image.sha256));
          if (!image || !opened) {
            throw new Refusal(404, 'notFound');
          }
          return reply
            .header('content-type', image.contentType)
            .header('content-length', String(opened.byteSize))
            .header('x-content-type-options', 'nosniff')
            .header('content-security-policy', "sandbox; default-src 'none'")
            .header('cache-control', 'private, max-age=300')
            .send(opened.stream);
        }),
    );

    // Removes a party's logo while its election is a draft or in preview.
    scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/parties/:id/logo',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            if (!holds(access, 'editor', 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            if (!editedDirectly(election.status)) {
              throw new Refusal(409, 'changeControlled');
            }
            if (
              (await setPartyLogo(trx, access.tenantId, election.id, request.params.id, null)) ===
              'notFound'
            ) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // The site's right-of-reply reports (editorial workflow H2): the queue, one status at a time or all, with how many
    // wait in each. Editors, reviewers and country admins see them; platform admins never do (P11), which RLS decides.
    scope.get<{ Params: { tenant: string }; Querystring: { status?: ReportStatus } }>(
      '/t/:tenant/reports',
      {
        schema: {
          params: TENANT_PARAMS,
          querystring: {
            type: 'object',
            properties: { status: { type: 'string', enum: REPORT_STATUSES } },
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            return {
              reports: await listReports(trx, access.tenantId, request.query.status),
              counts: await reportCounts(trx, access.tenantId),
              canTriage: access.roles.length > 0,
              canAnonymize: access.roles.includes('country_admin'),
              platformAdmin: access.platformAdmin,
            };
          }),
        ),
    );

    // One report in full, with what cites it (H2.4), and the names of who triaged it (members only, R94).
    scope.get<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/reports/:id',
      { schema: { params: ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { report, access, members } = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            const report = await getReport(trx, access.tenantId, request.params.id);
            if (!report) {
              throw new Refusal(404, 'notFound');
            }
            const memberIds = (await listMemberships(trx, access.tenantId)).map((m) => m.userId);
            return { report, access, members: new Set(memberIds) };
          });
          const ids = report.triagedBy && members.has(report.triagedBy) ? [report.triagedBy] : [];
          const found = profiles ? await profiles(ids, { emails: false }) : new Map();
          return {
            report,
            names: Object.fromEntries(ids.map((id) => [id, found.get(id)?.name ?? null])),
            canTriage: access.roles.length > 0,
            canAnonymize: access.roles.includes('country_admin'),
          };
        }),
    );

    // Moves a report on, with its internal note (H2.2, H2.3): the report rules decide which moves are allowed.
    scope.post<{
      Params: { tenant: string; id: string };
      Body: { status: Exclude<ReportStatus, 'new'>; resolutionNote?: string | null };
    }>(
      '/t/:tenant/reports/:id/status',
      {
        schema: {
          params: ID_PARAMS,
          body: {
            type: 'object',
            required: ['status'],
            additionalProperties: false,
            properties: {
              status: { type: 'string', enum: ['triaged', 'accepted', 'rejected', 'spam'] },
              resolutionNote: { type: ['string', 'null'], maxLength: 5_000 },
            },
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            const note = request.body.resolutionNote;
            const done = await triageReport(
              trx,
              access.tenantId,
              request.params.id,
              request.body.status,
              note === undefined ? undefined : optionalText(note),
            );
            if (!done) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Removes a report's personal data at once, on request (H2.5): country admins only, as the report rules say.
    scope.post<{ Params: { tenant: string; id: string } }>(
      '/t/:tenant/reports/:id/anonymize',
      { schema: { params: ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            if (!(await anonymizeReport(trx, access.tenantId, request.params.id))) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // The audit view (H3): a site's entries for its country admins and platform admins, the platform's own (no site)
    // for platform admins; RLS decides, and anyone else gets an empty page. Actors are named when they are members.
    const AUDIT_QUERY = {
      type: 'object',
      additionalProperties: false,
      properties: {
        actor: UUID,
        table: { type: 'string', pattern: '^[a-z_]{1,63}$' },
        row: { type: 'string', maxLength: 200 },
        from: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        to: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        // Below 10^18: a bigint holds every id, and the cursor is one.
        before: { type: 'string', pattern: '^[1-9][0-9]{0,17}$' },
      },
    } as const;
    type AuditQuery = {
      actor?: string;
      table?: string;
      row?: string;
      from?: string;
      to?: string;
      before?: string;
    };
    const auditNames = async (memberIds: string[], actorIds: (string | null)[]) => {
      const members = new Set(memberIds);
      const ids = [
        ...new Set(actorIds.filter((id): id is string => id !== null && members.has(id))),
      ];
      const found = profiles ? await profiles(ids, { emails: false }) : new Map();
      return Object.fromEntries(ids.map((id) => [id, found.get(id)?.name ?? null]));
    };
    scope.get<{ Params: { tenant: string }; Querystring: AuditQuery }>(
      '/t/:tenant/audit',
      { schema: { params: TENANT_PARAMS, querystring: AUDIT_QUERY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { page, memberIds } = await withActor(db, actor, async (trx) => {
            const access = await tenantFor(trx, actor, request.params.tenant);
            // Country admins' and platform admins' (H3.1): anyone else has no such page (RLS would show them nothing).
            if (!holds(access, 'country_admin')) {
              throw new Refusal(404, 'notFound');
            }
            const memberships = await listMemberships(trx, access.tenantId);
            return {
              page: await listAudit(trx, auditFilter(access.tenantId, request.query)),
              memberIds: memberships.map((m) => m.userId),
            };
          });
          return {
            ...page,
            names: await auditNames(
              memberIds,
              page.entries.map((entry) => entry.actorId),
            ),
            // The actor filter's choices: the site's members, by name.
            members: await auditNames(memberIds, memberIds),
          };
        }),
    );
    scope.get<{ Querystring: AuditQuery }>(
      '/platform/audit',
      { schema: { querystring: AUDIT_QUERY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const page = await withActor(db, actor, async (trx) => {
            if (!(await isPlatformAdmin(trx, actor.userId))) {
              throw new Refusal(404, 'notFound');
            }
            return listAudit(trx, auditFilter(null, request.query));
          });
          return { ...page, names: {}, members: {} };
        }),
    );

    // An election's corrections log as the public will see it (H1.4): every member reads it.
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/corrections',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, (db, actor) =>
          withActor(db, actor, async (trx) => {
            const { election } = await electionFor(trx, actor, request.params);
            return { entries: await listCorrections(trx, election) };
          }),
        ),
    );

    // An election's change requests (CR1), with what the user may do with them and the names of the members they
    // name (R94).
    scope.get<{ Params: { tenant: string; election: string } }>(
      '/t/:tenant/e/:election/changes',
      { schema: { params: ELECTION_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const { access, changes, memberIds, ownApprovals } = await withActor(
            db,
            actor,
            async (trx) => {
              const found = await electionFor(trx, actor, request.params);
              const tenant = await trx
                .selectFrom('app.tenants')
                .select('live_edits_need_second_approver')
                .where('id', '=', found.access.tenantId)
                .executeTakeFirstOrThrow();
              return {
                access: found.access,
                changes: await listChanges(trx, found.election.id),
                memberIds: (await listMemberships(trx, found.access.tenantId)).map((m) => m.userId),
                ownApprovals: !tenant.live_edits_need_second_approver,
              };
            },
          );
          const members = new Set(memberIds);
          const ids = [
            ...new Set(
              changes.flatMap((change) =>
                [change.proposedBy, change.decidedBy].filter((id): id is string => id !== null),
              ),
            ),
          ].filter((id) => members.has(id));
          const found = profiles ? await profiles(ids, { emails: false }) : new Map();
          return {
            changes,
            canPropose: holds(access, 'editor', 'country_admin'),
            canApprove: holds(access, 'country_admin'),
            canReject: holds(access, 'reviewer', 'country_admin'),
            ownApprovals,
            names: Object.fromEntries(ids.map((id) => [id, found.get(id)?.name ?? null])),
            you: actor.userId,
          };
        }),
    );

    // Proposes a change (CR1.1–3), and with `apply`, approves it in the same transaction as its proposer (CR1.5), which
    // the database allows only when the site needs no second approver and the proposer may write structure.
    scope.post<{
      Params: { tenant: string; election: string };
      Body: ChangeBody;
    }>(
      '/t/:tenant/e/:election/changes',
      { schema: { params: ELECTION_PARAMS, body: CHANGE_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          const id = await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            // Applying is approving, which is for country admins and platform admins (CR1.4), whatever else the
            // proposer holds: the database refuses it too.
            if (request.body.apply && !holds(access, 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            // Nor through a member's token, which drafts and never decides (ADR-0008): the database refuses it too.
            if (request.body.apply && actor.tokenId !== undefined) {
              throw new Refusal(403, 'notForTokens');
            }
            const proposal = changeProposal(request.body, access);
            // The report must be one the proposer can read: the foreign key alone would take any of the site's ids.
            if (proposal.reportId && !(await getReport(trx, access.tenantId, proposal.reportId))) {
              throw new Refusal(404, 'notFound');
            }
            if (
              proposal.action === 'add' &&
              proposal.targetKind !== 'election' &&
              proposal.targetKind !== 'methodology'
            ) {
              (proposal.value as Record<string, unknown>).display_order = await nextDisplayOrder(
                trx,
                election.id,
                proposal.targetKind,
              );
            }
            const created = await proposeChange(trx, access.tenantId, election.id, proposal);
            if (
              request.body.apply &&
              (await decideChange(trx, election.id, created, 'approved')) !== 'changed'
            ) {
              throw new Refusal(403, 'forbidden');
            }
            return created;
          });
          return reply.code(201).send({ id });
        }),
    );

    // Approves or rejects a pending request (CR1.4–6).
    scope.post<{
      Params: { tenant: string; election: string; id: string };
      Body: { state: 'approved' | 'rejected' };
    }>(
      '/t/:tenant/e/:election/changes/:id/decision',
      {
        schema: {
          params: ELECTION_ID_PARAMS,
          body: {
            type: 'object',
            properties: { state: { type: 'string', enum: ['approved', 'rejected'] } },
            required: ['state'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            if (
              !holds(
                access,
                ...(request.body.state === 'approved'
                  ? (['country_admin'] as const)
                  : (['reviewer', 'country_admin'] as const)),
              )
            ) {
              throw new Refusal(403, 'forbidden');
            }
            const result = await decideChange(
              trx,
              election.id,
              request.params.id,
              request.body.state,
            );
            if (result === undefined) {
              throw new Refusal(404, 'notFound');
            }
            if (result === 'decided') {
              throw new Refusal(409, 'stale');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Withdraws a pending proposal (CR1.7).
    scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
      '/t/:tenant/e/:election/changes/:id',
      { schema: { params: ELECTION_ID_PARAMS } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            if (!holds(access, 'editor', 'country_admin')) {
              throw new Refusal(403, 'forbidden');
            }
            if (!(await withdrawChange(trx, election.id, request.params.id))) {
              throw new Refusal(404, 'notFound');
            }
          });
          return reply.code(204).send();
        }),
    );

    // Parties and criteria (E4): the same five routes for each list.
    for (const list of ['parties', 'criteria'] as const) {
      const table = list === 'parties' ? 'app.parties' : 'app.criteria';
      scope.get<{ Params: { tenant: string; election: string } }>(
        `/t/:tenant/e/:election/${list}`,
        { schema: { params: ELECTION_PARAMS } },
        async (request, reply) =>
          signedIn(request, reply, (db, actor) =>
            withActor(db, actor, async (trx) => {
              const { access, election } = await electionFor(trx, actor, request.params);
              return list === 'parties'
                ? {
                    parties: await listParties(trx, election.id),
                    canEdit: holds(access, 'country_admin', 'editor'),
                  }
                : {
                    criteria: await listCriteria(trx, election.id),
                    coreCriteria: await listCoreCriteria(trx),
                    canEdit: holds(access, 'country_admin', 'editor'),
                  };
            }),
          ),
      );

      scope.post<{ Params: { tenant: string; election: string }; Body: unknown }>(
        `/t/:tenant/e/:election/${list}`,
        {
          schema: {
            params: ELECTION_PARAMS,
            body: list === 'parties' ? PARTY_BODY : CRITERION_BODY,
          },
        },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            const created = await withActor(db, actor, async (trx) => {
              const { access, election } = await electionFor(trx, actor, request.params);
              return list === 'parties'
                ? createParty(
                    trx,
                    access.tenantId,
                    election.id,
                    partyFields(request.body as PartyBody, access),
                  )
                : createCriterion(
                    trx,
                    access.tenantId,
                    election.id,
                    criterionFields(request.body as CriterionBody, access),
                  );
            });
            return reply.code(201).send(created);
          }),
      );

      scope.put<{
        Params: { tenant: string; election: string; id: string };
        Body: unknown;
      }>(
        `/t/:tenant/e/:election/${list}/:id`,
        {
          schema: {
            params: ELECTION_ID_PARAMS,
            body: list === 'parties' ? PARTY_BODY : CRITERION_BODY,
          },
        },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              const { access, election } = await electionFor(trx, actor, request.params);
              refuseUnless(
                list === 'parties'
                  ? await updateParty(
                      trx,
                      election.id,
                      request.params.id,
                      partyFields(request.body as PartyBody, access),
                    )
                  : await updateCriterion(
                      trx,
                      election.id,
                      request.params.id,
                      criterionFields(request.body as CriterionBody, access),
                    ),
              );
            });
            return reply.code(204).send();
          }),
      );

      scope.delete<{ Params: { tenant: string; election: string; id: string } }>(
        `/t/:tenant/e/:election/${list}/:id`,
        { schema: { params: ELECTION_ID_PARAMS } },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              refuseUnless(await deleteFrom(trx, table, election.id, request.params.id));
            });
            return reply.code(204).send();
          }),
      );

      // Puts the list in the order given (E4.5).
      scope.put<{
        Params: { tenant: string; election: string };
        Body: { shown: string[]; ids: string[] };
      }>(
        `/t/:tenant/e/:election/${list}/order`,
        {
          schema: {
            params: ELECTION_PARAMS,
            body: {
              type: 'object',
              properties: {
                shown: { type: 'array', items: UUID, maxItems: 500 },
                ids: { type: 'array', items: UUID, maxItems: 500 },
              },
              required: ['shown', 'ids'],
              additionalProperties: false,
            },
          },
        },
        async (request, reply) =>
          signedIn(request, reply, async (db, actor) => {
            await withActor(db, actor, async (trx) => {
              const { election } = await electionFor(trx, actor, request.params);
              refuseUnless(
                await reorder(trx, table, election.id, request.body.shown, request.body.ids),
              );
            });
            return reply.code(204).send();
          }),
      );
    }
  };
