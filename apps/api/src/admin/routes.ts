import type { Actor } from '@aiontheballot/db/actor';
import type { Database } from '@aiontheballot/db/client';
import type { DB } from '@aiontheballot/db/generated/db';
import type { Localized } from '@aiontheballot/domain/localized';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Transaction } from 'kysely';

import { withActor } from '@aiontheballot/db/actor';
import { type Rating, RATINGS } from '@aiontheballot/domain/methodology';
import {
  matchPrepared,
  type PreparedSource,
  prepareSource,
} from '@aiontheballot/domain/quote-match';
import { isLocale, LOCALES } from '@aiontheballot/i18n/messages';
import { captureException } from '@sentry/node';
import * as z from 'zod';

import type { InvitedAccounts } from '../auth/invited-accounts.js';
import type { ProfileSource } from './profiles.js';

import { databaseRefusal } from '../database-errors.js';
import { mailFailure } from '../mail/mailer.js';
import { createRateLimiter } from '../rate-limit.js';
import { type Access, accessTo, holds, isPlatformAdmin, TENANT_ROLES } from './access.js';
import { cellGrid } from './cell-grid.js';
import {
  addCheckedDocument,
  addQuote,
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
  sourceUnits,
  sourceVisible,
} from './cells.js';
import { goLiveChecklist } from './checklist.js';
import {
  createElection,
  deleteElection,
  type Election,
  ELECTION_TYPES,
  type ElectionType,
  getElection,
  listElections,
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
  platformLanguages,
  updateOrganization,
} from './organizations.js';
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
  setSiteSettings,
  type SiteFields,
  type SiteSettings,
} from './sites.js';
import {
  createCriterion,
  createParty,
  type CriterionFields,
  deleteFrom,
  listCoreCriteria,
  listCriteria,
  listParties,
  type PartyFields,
  reorder,
  setProgrammeStatus,
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
  'cellChanged',
] as const;
export type ApiRefusalKey = (typeof API_REFUSAL_KEYS)[number];

/**
 * Thrown inside a route's `withActor` transaction to refuse the request and roll back whatever it wrote, as the last
 * country admin's removal is.
 */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 422 | 429,
    readonly key:
      ApiRefusalKey | 'forbidden' | 'invalid' | 'incomplete' | 'stale' | 'taken' | 'limit',
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
  /** Invitations' accounts and email (A2); without them, inviting answers 503. */
  invitations?: { accounts: InvitedAccounts; send: InvitationSender };
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
}
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
  status?: 'live' | 'archived';
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
    status: { type: 'string', enum: ['live', 'archived'] },
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
  ({ admin, profiles, invitations, adminOrigin, actorFor }: AdminDataOptions) =>
  async (scope: FastifyInstance): Promise<void> => {
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

    const signedIn = async (
      request: FastifyRequest,
      reply: FastifyReply,
      run: (db: Database, actor: Actor) => Promise<unknown>,
    ): Promise<unknown> => {
      if (!admin) {
        return reply.code(503).send({ error: 'Admin data is not configured' });
      }
      const actor = await actorFor(request);
      if (!actor) {
        return reply.code(401).send({ error: 'Sign in with your second factor first' });
      }
      if (request.method !== 'GET' && request.headers.origin !== adminOrigin) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      try {
        return await run(admin, actor);
      } catch (error) {
        if (error instanceof Refusal) {
          return reply.code(error.status).send({ error: error.key });
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
          return { members, canManage: manager, emailsShown: manager };
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

    // A tenant's settings (T3, P1): the report retention, and whether live edits need a second approver.
    scope.patch<{
      Params: { tenant: string };
      Body: { reportRetentionDays?: number; liveEditsNeedSecondApprover?: boolean };
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
            // Fastify drops properties the schema doesn't name, so a body of only those arrives empty.
            if (reportRetentionDays === undefined && liveEditsNeedSecondApprover === undefined) {
              throw new Refusal(400, 'invalid');
            }
            refuseUnless(
              await updateSettings(trx, tenantId, {
                reportRetentionDays,
                liveEditsNeedSecondApprover,
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
          await withActor(db, actor, async (trx) => {
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
          });
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
          const ids = (
            cell.draft
              ? [
                  ...cell.draft.events.map((e) => e.actorId),
                  ...cell.draft.contributors,
                  ...cell.draft.checkedDocuments.map((c) => c.checkedBy),
                ]
              : []
          ).filter((id) => members.has(id));
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

    // Saves a draft's rating, summary, change kind and public note (C2, C10, C11), at the version loaded (C14).
    scope.put<{ Params: { tenant: string; election: string; id: string }; Body: CellBody }>(
      '/t/:tenant/e/:election/cells/:id',
      { schema: { params: ELECTION_ID_PARAMS, body: CELL_BODY } },
      async (request, reply) =>
        signedIn(request, reply, async (db, actor) => {
          await withActor(db, actor, async (trx) => {
            const { access, election } = await electionFor(trx, actor, request.params);
            refuseUnlessCell(
              await saveCell(trx, election.id, request.params.id, request.body.version, {
                rating: request.body.rating,
                summary: optionalLocalizedInput(request.body.summary, access),
                changeKind: request.body.changeKind,
                publicNote: optionalLocalizedInput(request.body.publicNote, access),
              }),
            );
          });
          return reply.code(204).send();
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
          await withActor(db, actor, async (trx) => {
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
          });
          return reply.code(201).send();
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
          await withActor(db, actor, async (trx) => {
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
          });
          return reply.code(204).send();
        }),
    );

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
          await withActor(db, actor, async (trx) => {
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
          });
          return reply.code(201).send();
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
          await withActor(db, actor, async (trx) => {
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
          });
          return reply.code(204).send();
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
        signedIn(request, reply, (db, actor) =>
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
        ),
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
