import type { Database } from '@aiontheballot/db/client';
import type { FileSpace, FileStore } from '@aiontheballot/db/file-store';
import type {
  PublicDocument,
  PublicHome,
  TenantDocumentKind,
} from '@aiontheballot/domain/public-home';

import { isLocalized, type Localized } from '@aiontheballot/domain/localized';
import { sql } from 'kysely';

/** A tenant's home data by slug; undefined when no active tenant has that slug. */
export type HomeSource = (slug: string) => Promise<PublicHome | undefined>;

/** One of a tenant's brand images, by the SHA-256 of its bytes; undefined unless the tenant shows it publicly. */
export type BrandImageSource = (
  slug: string,
  sha256: string,
) => Promise<{ contentType: string; content: Uint8Array } | undefined>;

const localized = (value: unknown, column: string): Localized => {
  if (!isLocalized(value)) {
    throw new Error(`${column} is not localized text`);
  }
  return value;
};

const DOCUMENT_KINDS: readonly string[] = [
  'privacy_policy',
  'right_of_reply_policy',
  'about_operator',
] satisfies TenantDocumentKind[];

/**
 * Reads a tenant's home data as aiontheballot_web, so RLS decides what is public: an inactive tenant doesn't exist,
 * and neither does an election that isn't public, nor a policy text that isn't published. The signup list is offered
 * only when the API can send mail (`mail`) and the emails' links have an address: the tenant's own hostname, or the
 * platform's path (`platformHost`).
 */
export const createHomeSource =
  (
    db: Database,
    { mail = false, platformHost }: { mail?: boolean; platformHost?: string | undefined } = {},
  ): HomeSource =>
  async (slug) => {
    const tenant = await db
      .selectFrom('app.tenants')
      .select([
        'id',
        'display_name',
        'default_locale',
        'country_code',
        'methodology_kind',
        // Whether its emails' links have an address to go to: its own hostname, or the platform's path.
        (eb) =>
          eb
            .exists(
              eb
                .selectFrom('app.tenant_hostnames as h')
                .select('h.hostname')
                .whereRef('h.tenant_id', '=', 'app.tenants.id')
                .where('h.is_canonical', '=', true),
            )
            .as('has_canonical_host'),
      ])
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!tenant) {
      return undefined;
    }
    const [operator, election, brand, documents, elections] = await Promise.all([
      db
        .selectFrom('app.tenant_organizations as link')
        .innerJoin('app.organizations as o', 'o.id', 'link.organization_id')
        .select([
          'o.display_name',
          'o.url',
          'o.contact_email',
          'o.newsletter_url',
          'o.legal_name',
          'o.tax_id',
          'o.address',
          'o.registry_entry',
          'o.privacy_email',
        ])
        .where('link.tenant_id', '=', tenant.id)
        .where('link.role', '=', 'operator')
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('app.elections')
        // A date as text: pg would turn it into a Date at local midnight, which can shift the day.
        .select(['name', sql<string | null>`election_date::text`.as('date')])
        .where('tenant_id', '=', tenant.id)
        .where('status', '<>', 'archived')
        .where((eb) =>
          eb.or([
            eb('election_date', 'is', null),
            eb('election_date', '>=', sql<Date>`current_date`),
          ]),
        )
        .orderBy(sql`election_date nulls last`)
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst(),
      // As the public role: an upload shows only while an active tenant selects it (ADR-0002).
      db
        .selectFrom('app.tenant_brand_selections as s')
        .leftJoin('app.files as f', 'f.id', 's.file_id')
        .leftJoin('app.brand_assets as a', 'a.id', 's.brand_asset_id')
        .select([
          's.slot',
          sql<string | null>`coalesce(f.sha256, a.sha256)`.as('sha256'),
          sql<string | null>`coalesce(f.content_type, a.content_type)`.as('content_type'),
        ])
        .where('s.tenant_id', '=', tenant.id)
        .execute(),
      // The latest published version of each kind.
      db
        .selectFrom('app.tenant_documents')
        .select([
          'kind',
          'body',
          'version',
          sql<string>`to_json(published_at)#>>'{}'`.as('published_at'),
        ])
        .distinctOn('kind')
        .where('tenant_id', '=', tenant.id)
        .where('published_at', 'is not', null)
        .orderBy('kind')
        .orderBy('version', 'desc')
        .execute(),
      // The public ones, the current first: live before archived, the soonest live, the latest archived.
      db
        .selectFrom('app.elections')
        .select(['slug', 'name', 'status', sql<string | null>`election_date::text`.as('date')])
        .where('tenant_id', '=', tenant.id)
        .where('status', 'in', ['live', 'archived'])
        .orderBy(sql`status = 'live'`, 'desc')
        .orderBy(sql`CASE WHEN status = 'live' THEN election_date END`, sql`asc nulls last`)
        .orderBy('election_date', sql`desc nulls last`)
        .orderBy('created_at', 'desc')
        .execute(),
    ]);
    const published: Partial<Record<TenantDocumentKind, PublicDocument>> = {};
    for (const doc of documents) {
      if (DOCUMENT_KINDS.includes(doc.kind)) {
        published[doc.kind as TenantDocumentKind] = {
          body: localized(doc.body, 'tenant_documents.body'),
          version: doc.version,
          publishedAt: doc.published_at,
        };
      }
    }
    return {
      tenant: {
        displayName: localized(tenant.display_name, 'tenants.display_name'),
        defaultLocale: tenant.default_locale,
        countryCode: tenant.country_code,
        methodologyKind: tenant.methodology_kind,
      },
      operator: {
        displayName: localized(operator.display_name, 'organizations.display_name'),
        url: operator.url,
        contactEmail: operator.contact_email,
        newsletterUrl: operator.newsletter_url,
        legalName: operator.legal_name,
        taxId: operator.tax_id,
        address: operator.address,
        registryEntry: operator.registry_entry,
        privacyEmail: operator.privacy_email,
      },
      documents: published,
      elections: elections.flatMap(({ slug, name, status, date }) =>
        status === 'live' || status === 'archived'
          ? [{ slug, name: localized(name, 'elections.name'), date, status }]
          : [],
      ),
      signups:
        mail &&
        published.privacy_policy !== undefined &&
        (tenant.has_canonical_host === true || platformHost !== undefined),
      election: election
        ? { name: localized(election.name, 'elections.name'), date: election.date }
        : null,
      brand: Object.fromEntries(
        brand.flatMap(({ slot, sha256, content_type: contentType }) =>
          sha256 && contentType ? [[slot, { sha256, contentType }]] : [],
        ),
      ),
    };
  };

/**
 * Reads a brand image's bytes: its row as aiontheballot_web, so only one the tenant's selections name and RLS shows,
 * then the bytes under its hash, in that row's own space on the file store (ADR-0004): the uploading tenant's
 * public_assets bucket, or the platform's for a brand asset. A row can't reach bytes stored for anyone else.
 */
export const createBrandImageSource =
  (db: Database, store: FileStore): BrandImageSource =>
  async (slug, sha256) => {
    const row = await db
      .selectFrom('app.tenant_brand_selections as s')
      .innerJoin('app.tenants as t', 't.id', 's.tenant_id')
      .leftJoin('app.files as f', 'f.id', 's.file_id')
      .leftJoin('app.brand_assets as a', 'a.id', 's.brand_asset_id')
      .select([
        'f.tenant_id as file_tenant_id',
        'f.bucket as file_bucket',
        sql<string | null>`coalesce(f.content_type, a.content_type)`.as('content_type'),
      ])
      .where('t.slug', '=', slug)
      .where(sql<boolean>`coalesce(f.sha256, a.sha256) = ${sha256}`)
      .limit(1)
      .executeTakeFirst();
    if (!row?.content_type) {
      return undefined;
    }
    const space: FileSpace =
      row.file_tenant_id && row.file_bucket
        ? { tenantId: row.file_tenant_id, bucket: row.file_bucket }
        : 'platform';
    const content = await store.get(space, sha256);
    return content ? { contentType: row.content_type, content } : undefined;
  };
